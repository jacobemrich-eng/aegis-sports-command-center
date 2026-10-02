const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const html = read('public/index.html');
const css = read('public/public-beta.css');
const app = read('public/public-beta.js');
const wrangler = JSON.parse(read('wrangler.jsonc'));

test('Home is the default public experience and the operator command is not the anonymous landing page', () => {
  assert.match(html, /<section id="home" class="page pb-home"/);
  assert.match(html, /class="navbtn active" data-tab="home"/);
  assert.match(html, /<section id="command" class="page hidden">/);
  assert.match(html, /Smarter betting decisions, every day\./);
  assert.doesNotMatch(html, /data-pb-nav="command"[^>]*>Run Today’s Scan/i);
});

test('public navigation and the discreet authenticated Command Center route are present', () => {
  for (const [tab, label] of [
    ['home', 'Home'],
    ['ask', 'Ask AEGIS'],
    ['sports', 'Sports'],
    ['board', 'Board'],
    ['card', 'Final Card'],
    ['results', 'Results'],
    ['models', 'Models']
  ]) {
    assert.match(html, new RegExp(`data-tab="${tab}"[^>]*>${label}<`));
  }
  assert.match(html, /data-tab="command" data-admin-only[^>]*>Admin \/ Command Center</);
  assert.match(app, /aegis:session-change/);
  assert.match(app, /pb-admin-action/);
});

test('legacy operational IDs and administrator login contract remain available exactly once', () => {
  for (const id of [
    'sport', 'markets', 'sync', 'scan', 'boardGrid', 'labGame', 'labContent',
    'cardContent', 'auditMetrics', 'auditRows', 'modelGrid', 'adminSessionButton',
    'loginDialog', 'loginForm', 'loginPin', 'loginSubmit', 'loginCancel'
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(html, /type="password" inputmode="numeric" autocomplete="current-password"/);
  assert.match(html, /RUN FULL AUTOMATIC SLATE SCAN/);
});

test('public beta reads only the approved public registry, card, and ledger APIs', () => {
  for (const endpoint of ['/api/sports', '/api/models', '/api/cards/latest', '/api/results/ledger']) {
    assert.match(app, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(app, /\/api\/(?:scan|odds|autopilot\/tick|results\/grade|card\/lock)/);
});

test('Ask AEGIS Sprint 1 is deterministic, inline, and does not call an external AI service', () => {
  assert.match(app, /function submitAssistantRequest/);
  assert.match(app, /function routeAssistantIntent/);
  assert.match(app, /function renderAssistantMessage/);
  assert.match(app, /Deep Ask AEGIS analysis is being connected in the next integration phase/);
  assert.doesNotMatch(app, /openai|anthropic|gemini|api\.openai\.com|chat\/completions|responses\/v1/i);
  assert.doesNotMatch(app, /alert\s*\(/);
});

test('user prompts are rendered as text and cannot be injected as raw HTML', () => {
  assert.match(app, /node\.textContent = String\(text\)/);
  assert.match(app, /bubble\.appendChild\(element\('span', '', message\)\)/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.doesNotMatch(app, /insertAdjacentHTML|document\.write/);
});

test('public UI introduces no third-party script, style, font, image, or tracker dependency', () => {
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)="https?:\/\//i);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:\/\//i);
  assert.doesNotMatch(app, /https?:\/\//i);
  assert.doesNotMatch(html + app, /google-analytics|googletagmanager|segment\.com|mixpanel/i);
});

test('public presentation contains no prohibited hard-coded performance claims', () => {
  const publicSources = html + '\n' + css + '\n' + app;
  for (const fake of ['68%', '+24.8%', '+12.4u', '93%', '56.3%']) assert.doesNotMatch(publicSources, new RegExp(fake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(app, /state\.ledger\.filter/);
  assert.match(app, /Not enough graded results yet\./);
});

test('cards and sports remain grounded in canonical availability and honest empty states', () => {
  assert.match(app, /sportByKey\(item\.key\)/);
  assert.match(app, /Coming soon/);
  assert.match(app, /No qualified card has been published yet\./);
  assert.match(app, /\['CORE', 'SECONDARY'\]/);
  assert.match(app, /Pass decision/);
  assert.doesNotMatch(app, /win probability|guaranteed profit/i);
});

test('responsive, accessible public styles cover phone, tablet, desktop, focus, and reduced motion', () => {
  for (const query of ['max-width:390px', 'max-width:430px', 'max-width:768px', 'min-width:1280px', 'prefers-reduced-motion:reduce']) assert.match(css, new RegExp(query.replace(/[()]/g, '\\$&')));
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('Cloudflare preview is explicit, safe, and remains asset-first', () => {
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.assets.directory, './public');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.notEqual(wrangler.assets.run_worker_first, true);
  assert.equal('run_worker_first' in wrangler.assets, false);
  assert.equal(wrangler.previews.vars.AEGIS_EDGE_PLATFORM_MODE, 'cloudflare-edge-preview');
  assert.deepEqual(wrangler.previews.vars, wrangler.vars);
  const serialized = JSON.stringify(wrangler);
  assert.doesNotMatch(serialized, /SUPABASE_(?:SECRET|SERVICE_ROLE)|ODDS_API_KEY|SPORTSGAMEODDS_API_KEY|AEGIS_ACCESS_PIN|SESSION_SECRET/);
});

test('canonical engine, Render rollback path, and production Autopilot workflow remain present', () => {
  const engine = require('../src/engine');
  assert.equal(engine.VERSION, '8.8.0-decision-intelligence');
  assert.equal(fs.existsSync(path.join(ROOT, 'render.yaml')), true);
  assert.equal(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'aegis-autopilot.yml')), true);
  assert.match(read('package.json'), /node --check public\/public-beta\.js/);
});
