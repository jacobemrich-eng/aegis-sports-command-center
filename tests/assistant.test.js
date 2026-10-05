const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const workerSource = read('cloudflare/worker.mjs');
const publicSource = read('public/public-beta.js');
const html = read('public/index.html');
const wrangler = JSON.parse(read('wrangler.jsonc'));

let workerModule;
async function worker() {
  workerModule ||= import(pathToFileURL(path.join(ROOT, 'cloudflare', 'worker.mjs')).href);
  return workerModule;
}

function env(overrides = {}) {
  return {
    AEGIS_ASSISTANT_ENABLED: 'true',
    AEGIS_ASSISTANT_MODEL: 'gpt-5-mini',
    OPENAI_API_KEY: 'test-key-never-real',
    AEGIS_ASSISTANT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides
  };
}

function assistantRequest(body, options = {}) {
  const headers = {
    Origin: 'https://edge.example',
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
    ...options.headers
  };
  return new Request('https://edge.example/api/assistant', {
    method: options.method || 'POST',
    headers,
    body: (options.method || 'POST') === 'GET' ? undefined : (options.raw ?? JSON.stringify(body))
  });
}

async function withFetch(mock, run) {
  const original = global.fetch;
  global.fetch = mock;
  try { return await run(); } finally { global.fetch = original; }
}

function responsePayload(text) {
  return { output_text: text, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}

function functionCall(name, args, callId = 'call_1') {
  return { output: [{ type: 'function_call', name, arguments: typeof args === 'string' ? args : JSON.stringify(args), call_id: callId }] };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('assistant is POST-only, same-origin, JSON-only, and bounded', { concurrency: false }, async () => {
  const module = await worker();
  let response = await module.default.fetch(assistantRequest(null, { method: 'GET' }), env());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');

  response = await module.default.fetch(new Request('https://edge.example/api/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example', 'Sec-Fetch-Site': 'cross-site' }, body: '{}'
  }), env());
  assert.equal(response.status, 403);

  response = await module.default.fetch(assistantRequest(null, { raw: '{nope' }), env());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_request');

  response = await module.default.fetch(assistantRequest({ prompt: 'x'.repeat(1001) }), env());
  assert.equal(response.status, 400);

  response = await module.default.fetch(assistantRequest({ prompt: 'hello', padding: 'x'.repeat(17000) }), env());
  assert.equal(response.status, 413);

  response = await module.default.fetch(assistantRequest({ prompt: 'hello', history: Array.from({ length: 7 }, () => ({ role: 'user', content: 'bounded' })) }), env());
  assert.equal(response.status, 400);

  response = await module.default.fetch(assistantRequest({ prompt: '<b>bet</b>' }), env());
  assert.equal(response.status, 400);

  response = await module.default.fetch(assistantRequest({ prompt: 'hello' }, { headers: { 'Content-Type': 'text/plain' } }), env());
  assert.equal(response.status, 415);
});

test('assistant stays disabled by default and requires its server-side key', { concurrency: false }, async () => {
  const module = await worker();
  let response = await module.default.fetch(assistantRequest({ prompt: 'hello' }), env({ AEGIS_ASSISTANT_ENABLED: 'false' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'assistant_disabled');
  response = await module.default.fetch(assistantRequest({ prompt: 'hello' }), env({ OPENAI_API_KEY: '' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'assistant_unavailable');
});

test('Cloudflare rate limit rejects the seventh-style request before upstream spend', { concurrency: false }, async () => {
  const module = await worker();
  let upstreamCalls = 0;
  const response = await withFetch(async () => { upstreamCalls++; throw new Error('unexpected upstream'); }, () =>
    module.default.fetch(assistantRequest({ prompt: 'What is published?' }), env({
      AEGIS_ASSISTANT_RATE_LIMITER: { limit: async () => ({ success: false }) }
    }))
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal((await response.json()).code, 'rate_limited');
  assert.equal(upstreamCalls, 0);
  assert.deepEqual(wrangler.ratelimits[0].simple, { limit: 6, period: 60 });
  assert.deepEqual(wrangler.previews.ratelimits[0].simple, { limit: 6, period: 60 });
  assert.notEqual(wrangler.previews.ratelimits[0].namespace_id, wrangler.ratelimits[0].namespace_id);
});

test('assistant rate limit identity cannot be changed by rotating the user agent', { concurrency: false }, async () => {
  const module = await worker();
  const keys = [];
  const limiter = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const first = assistantRequest({ prompt: 'Question' }, { headers: { 'CF-Connecting-IP': '203.0.113.8', 'User-Agent': 'Browser A' } });
  const second = assistantRequest({ prompt: 'Question' }, { headers: { 'CF-Connecting-IP': '203.0.113.8', 'User-Agent': 'Browser B' } });
  const third = assistantRequest({ prompt: 'Question' }, { headers: { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'Browser A' } });
  await module.default.fetch(first, env({ AEGIS_ASSISTANT_RATE_LIMITER: limiter }));
  await module.default.fetch(second, env({ AEGIS_ASSISTANT_RATE_LIMITER: limiter }));
  await module.default.fetch(third, env({ AEGIS_ASSISTANT_RATE_LIMITER: limiter }));
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

test('successful answer uses Responses API with store false and configured cost bounds', { concurrency: false }, async () => {
  const module = await worker();
  let requestBody;
  const response = await withFetch(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requestBody = JSON.parse(options.body);
    return jsonResponse(responsePayload('AEGIS uses governed release tiers.'));
  }, () => module.default.fetch(assistantRequest({ prompt: 'How does AEGIS govern a release?' }), env()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    response: 'AEGIS uses governed release tiers.',
    tools_used: [],
    grounded: false,
    requires_scan: false
  });
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.max_output_tokens, 500);
  assert.deepEqual(requestBody.reasoning, { effort: 'minimal' });
  assert.equal(requestBody.parallel_tool_calls, true);
  assert.match(requestBody.instructions, /Request independent read-only lookups together/);
  assert.match(requestBody.instructions, /call exactly get_sports, get_models with sport null, and get_results/);
  assert.equal(requestBody.tools.some(tool => tool.type !== 'function'), false);
  assert.deepEqual(requestBody.tools.map(tool => tool.name), module.contracts.ASSISTANT_TOOL_NAMES);
});

test('approved read-only tool call grounds the response and replays tool output', { concurrency: false }, async () => {
  const module = await worker();
  const requests = [];
  let call = 0;
  const response = await withFetch(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requests.push(JSON.parse(options.body));
    call++;
    return jsonResponse(call === 1 ? functionCall('get_sports', {}) : responsePayload('NFL is in the canonical registry.'));
  }, () => module.default.fetch(assistantRequest({ prompt: 'Which sports are supported?' }), env()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    response: 'NFL is in the canonical registry.',
    tools_used: ['get_sports'],
    grounded: true,
    requires_scan: false
  });
  assert.equal(requests[1].store, false);
  assert.equal(requests[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'call_1'), true);
});

test('published overview deterministically seeds three bounded read-only lookups', { concurrency: false }, async () => {
  const module = await worker();
  let openaiCalls = 0;
  const audit = [
    { event_id: 'graded-old', result: 'WIN', graded_at: '2026-10-03T20:00:00Z' },
    { event_id: 'pending-old', result: null, graded_at: null },
    { event_id: 'graded-new', result: 'LOSS', graded_at: '2026-10-04T20:00:00Z' },
    { event_id: 'pending-new', result: null, graded_at: null }
  ];
  const response = await withFetch(async (url, options) => {
    if (String(url).startsWith('https://supabase.example/')) return jsonResponse([{ audit }]);
    openaiCalls++;
    throw new Error(`Unexpected upstream request: ${url}`);
  }, () => module.default.fetch(assistantRequest({
    prompt: 'What is currently published?',
    history: [
      { role: 'user', content: 'View today\u2019s best AEGIS plays' },
      { role: 'assistant', content: 'No published AEGIS recommendation is available.' }
    ]
  }), env({
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'sb_secret_test'
  })));
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.match(responseBody.response, /sports in its canonical registry/);
  assert.match(responseBody.response, /governed model and system definitions/);
  assert.match(responseBody.response, /2 graded records/);
  assert.doesNotMatch(responseBody.response, /4 graded records/);
  assert.match(responseBody.response, /does not run a scan or create a recommendation/);
  assert.deepEqual(responseBody.tools_used, ['get_sports', 'get_models', 'get_results']);
  assert.equal(responseBody.grounded, true);
  assert.equal(responseBody.requires_scan, false);
  assert.equal(openaiCalls, 0);
});

test('bounded multi-tool orchestration succeeds and rejects an excessive loop', { concurrency: false }, async () => {
  const module = await worker();
  let call = 0;
  let response = await withFetch(async () => {
    call++;
    if (call === 1) return jsonResponse({ output: [
      functionCall('get_sports', {}, 'one').output[0],
      functionCall('get_models', { sport: null }, 'two').output[0]
    ] });
    return jsonResponse(responsePayload('Registry and model systems retrieved.'));
  }, () => module.default.fetch(assistantRequest({ prompt: 'Summarize coverage and models.' }), env()));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).tools_used, ['get_sports', 'get_models']);
  assert.equal(call, 2);

  call = 0;
  response = await withFetch(async () => {
    call++;
    return jsonResponse(functionCall('get_sports', {}, `loop_${call}`));
  }, () => module.default.fetch(assistantRequest({ prompt: 'Keep checking forever.' }), env()));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'assistant_tool_limit');
});

test('unknown tools and malformed tool arguments are rejected without execution', { concurrency: false }, async () => {
  const module = await worker();
  let response = await withFetch(async () => jsonResponse(functionCall('run_scan', {})), () =>
    module.default.fetch(assistantRequest({ prompt: 'Use a forbidden tool.' }), env())
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'assistant_unknown_tool');

  response = await withFetch(async () => jsonResponse(functionCall('get_latest_card', '{bad')), () =>
    module.default.fetch(assistantRequest({ prompt: 'Show a card.' }), env())
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'assistant_invalid_tool_arguments');
});

test('Watch and Pass decisions cannot be transformed into actionable advice', { concurrency: false }, async () => {
  const module = await worker();
  const cards = {
    watch: { generated_at: '2026-10-03T12:00:00Z', plays: [{ event_id: 'w1', event: { away_team: 'Bruins', home_team: 'Rangers' }, tier: 'WATCH', selection: 'Bruins', why: 'Confirmation gate remains open.' }] },
    pass: { generated_at: '2026-10-03T12:00:00Z', plays: [], passes: [{ event_id: 'p1', matchup: 'Mets at Phillies', reason: 'Release gates failed.' }] }
  };
  async function run(card, sport) {
    let openaiCalls = 0;
    return withFetch(async url => {
      if (String(url).startsWith('https://api.openai.com')) {
        openaiCalls++;
        return jsonResponse(openaiCalls === 1 ? functionCall('get_latest_card', { sport }) : responsePayload('Bet it now. Upgrade it to Core and lock the play.'));
      }
      if (String(url).includes('/rest/v1/aegis_state')) return jsonResponse([{ card }]);
      throw new Error(`Unexpected URL ${url}`);
    }, () => module.default.fetch(assistantRequest({ prompt: 'What should I bet?' }), env({ SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_test' })));
  }
  let response = await run(cards.watch, 'icehockey_nhl');
  let body = await response.json();
  assert.equal(body.grounded, true);
  assert.match(body.response, /WATCH/);
  assert.match(body.response, /not an actionable recommendation/i);
  assert.doesNotMatch(body.response, /upgrade it to Core/i);

  response = await run(cards.pass, 'baseball_mlb');
  body = await response.json();
  assert.match(body.response, /PASS/);
  assert.match(body.response, /not an actionable recommendation/i);
});

test('absent canonical analysis returns requires_scan and never fabricates a recommendation', { concurrency: false }, async () => {
  const module = await worker();
  let openaiCalls = 0;
  const response = await withFetch(async url => {
    if (String(url).startsWith('https://api.openai.com')) {
      openaiCalls++;
      throw new Error('OpenAI must not be called for an absent fresh-scan request.');
    }
    if (String(url).includes('/rest/v1/aegis_state')) return jsonResponse([{ cards: {} }]);
    throw new Error(`Unexpected URL ${url}`);
  }, () => module.default.fetch(assistantRequest({ prompt: 'Run AEGIS on Bruins vs Rangers.' }), env({ SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_test' })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requires_scan, true);
  assert.equal(body.grounded, true);
  assert.deepEqual(body.tools_used, ['get_play_details']);
  assert.doesNotMatch(body.response, /Core pick|odds|projection/i);
  assert.equal(openaiCalls, 0);
});

test('upstream failures map to controlled errors and never expose secrets', { concurrency: false }, async () => {
  const module = await worker();
  async function run(mock) {
    return withFetch(mock, () => module.default.fetch(assistantRequest({ prompt: 'Question' }), env({ OPENAI_API_KEY: 'super-secret-test-value' })));
  }
  let response = await run(async () => jsonResponse({ error: { code: 'rate_limit_exceeded', message: 'super-secret-test-value' } }, 429));
  let raw = await response.text();
  assert.equal(JSON.parse(raw).code, 'assistant_upstream_rate_limited');
  assert.doesNotMatch(raw, /super-secret/);

  response = await run(async () => jsonResponse({ error: { code: 'insufficient_quota' } }, 429));
  assert.equal((await response.json()).code, 'assistant_credits_exhausted');

  response = await run(async () => { throw new DOMException('aborted', 'AbortError'); });
  assert.equal((await response.json()).code, 'assistant_timeout');

  response = await run(async () => jsonResponse({ id: 'missing-output' }));
  assert.equal((await response.json()).code, 'assistant_malformed_response');

  response = await run(async () => jsonResponse({
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'reasoning' }]
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'assistant_output_limit');
});

test('only approved read-only tools are exposed and client output remains XSS-safe', async () => {
  const module = await worker();
  assert.deepEqual(module.contracts.ASSISTANT_TOOL_NAMES, [
    'get_sports', 'get_models', 'get_latest_card', 'get_results', 'get_play_details'
  ]);
  assert.doesNotMatch(workerSource, /type:\s*['"]web_search/);
  const toolExecutor = workerSource.slice(workerSource.indexOf('async function executeAssistantTool'), workerSource.indexOf('function assistantInput'));
  assert.doesNotMatch(toolExecutor, /\/api\/(?:scan|odds|card\/lock|results\/grade|autopilot\/tick)/);
  assert.doesNotMatch(toolExecutor, /runEngine|autopilot\.|providerRequest|oddsRequest|method:\s*['"](?:POST|PATCH|DELETE)/i);
  assert.match(publicSource, /API\.assistant/);
  assert.match(publicSource, /textContent = String\(text\)/);
  assert.doesNotMatch(publicSource, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(publicSource + html, /OPENAI_API_KEY|api\.openai\.com/);
  assert.doesNotMatch(JSON.stringify(wrangler), /OPENAI_API_KEY/);
  assert.equal(wrangler.vars.AEGIS_ASSISTANT_ENABLED, 'false');
  assert.equal(wrangler.previews.vars.AEGIS_ASSISTANT_ENABLED, 'true');
  assert.deepEqual(
    { ...wrangler.previews.vars, AEGIS_ASSISTANT_ENABLED: 'false' },
    wrangler.vars
  );
  assert.equal(require('../src/engine').VERSION, '8.8.0-decision-intelligence');
});
