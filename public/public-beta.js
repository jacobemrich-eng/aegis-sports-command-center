(function () {
  'use strict';

  var API = {
    sports: '/api/sports',
    models: '/api/models',
    cards: '/api/cards/latest',
    results: '/api/results/ledger',
    assistant: '/api/assistant'
  };
  var RECENT_KEY = 'aegis_public_recent_prompts_v1';
  var LAST_VIEW_KEY = 'aegis_public_last_view_v1';
  var LAST_SPORT_KEY = 'aegis_public_last_sport_v1';
  var FAVORITES_KEY = 'aegis_favorites_v6';
  var PUBLIC_VIEWS = new Set(['home', 'ask', 'sports', 'board', 'card', 'results', 'models']);
  var PRIORITY_SPORTS = [
    { title: 'NFL', key: 'americanfootball_nfl', monogram: 'NFL' },
    { title: 'NCAAF', key: 'americanfootball_ncaaf', monogram: 'CFB' },
    { title: 'NHL', key: 'icehockey_nhl', monogram: 'NHL' },
    { title: 'MLB', key: 'baseball_mlb', monogram: 'MLB' },
    { title: 'NBA', key: 'basketball_nba', monogram: 'NBA' }
  ];
  var state = { sports: [], models: [], cards: new Map(), ledger: [], selectedCardSport: null, assistantHistory: [], assistantBusy: false };

  function one(selector, root) { return (root || document).querySelector(selector); }
  function all(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { if (node) node.replaceChildren(); return node; }
  function safeStorageGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (_) { return fallback; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  async function fetchJson(url) {
    var response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || 'Public data is temporarily unavailable.');
    return body;
  }
  function sportByKey(key) { return state.sports.find(function (sport) { return sport.key === key; }); }
  function sportTitle(key) { return (sportByKey(key) || PRIORITY_SPORTS.find(function (sport) { return sport.key === key; }) || { title: key || 'AEGIS' }).title; }
  function relativeTime(value) {
    var time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || !time) return 'No published card';
    var minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return 'Latest card just now';
    if (minutes < 60) return 'Latest card ' + minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    if (hours < 48) return 'Latest card ' + hours + 'h ago';
    return 'Latest card ' + Math.round(hours / 24) + 'd ago';
  }
  function matchup(play) {
    var event = play && play.event || {};
    if (event.away_team && event.home_team) return event.away_team + ' at ' + event.home_team;
    return play && (play.matchup || play.event_name) || 'Published AEGIS market';
  }
  function lineAndPrice(play) {
    var values = [];
    if (play && play.point !== undefined && play.point !== null && play.point !== '') {
      var point = Number(play.point);
      values.push(Number.isFinite(point) && point > 0 ? '+' + point : String(play.point));
    }
    if (play && play.price !== undefined && play.price !== null && play.price !== '') {
      var price = Number(play.price);
      values.push(Number.isFinite(price) && price > 0 ? '+' + Math.round(price) : String(play.price));
    }
    return values.join(' · ');
  }
  function marketLabel(value) {
    return String(value || 'Market').replaceAll('_', ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }
  function setViewState(view) {
    document.body.classList.toggle('pb-command-active', view === 'command');
    var label = one('#v82TopSection');
    if (label) label.textContent = view === 'command' ? 'Command Center' : view === 'card' ? 'Final Card' : view.charAt(0).toUpperCase() + view.slice(1);
    if (PUBLIC_VIEWS.has(view) && view !== 'home') safeStorageSet(LAST_VIEW_KEY, view);
  }
  function openView(view) {
    var button = one('.navbtn[data-tab="' + view + '"]');
    if (!button) return false;
    button.click();
    queueMicrotask(function () { setViewState(view); });
    if (history.replaceState) history.replaceState(null, '', '#' + view);
    return true;
  }
  function selectLegacySport(key) {
    var select = one('#sport');
    if (!select || !Array.from(select.options).some(function (option) { return option.value === key; })) return false;
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    safeStorageSet(LAST_SPORT_KEY, key);
    return true;
  }
  function syncSession(authenticated) {
    all('[data-pb-admin]').forEach(function (button) {
      button.textContent = authenticated ? 'Logout' : 'Admin';
      button.dataset.authenticated = authenticated ? 'true' : 'false';
      button.setAttribute('aria-label', authenticated ? 'Log out of administrator session' : 'Open administrator login');
    });
    all('.pb-admin-action').forEach(function (button) { button.hidden = !authenticated; });
  }
  function greeting() {
    var hour = new Date().getHours();
    return hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
  }

  function renderBriefing() {
    var title = one('#pbBriefingTitle');
    var status = one('#pbBriefingStatus');
    if (title) title.textContent = greeting();
    var available = Array.from(state.cards.values()).filter(Boolean);
    if (!status) return;
    if (available.length) status.textContent = 'AEGIS currently has cards available across ' + available.length + ' sport' + (available.length === 1 ? '.' : 's.');
    else status.textContent = 'No current AEGIS card has been published for the available sports yet.';
  }
  function contextualSportLabel(item, available, card) {
    if (!available) return 'Coming soon';
    if (card) return relativeTime(card.generated_at);
    if (item.key === 'baseball_mlb') return 'Seasonal coverage available';
    return 'No current card published';
  }
  function createSportCard(item, full) {
    var available = !!sportByKey(item.key);
    var card = state.cards.get(item.key) || null;
    var article = element('article', 'pb-sport-card' + (available ? '' : ' is-coming'));
    article.appendChild(element('span', 'pb-sport-monogram', item.monogram || item.title.slice(0, 3).toUpperCase()));
    var copy = element('div');
    copy.appendChild(element('h3', '', item.title));
    copy.appendChild(element('p', '', contextualSportLabel(item, available, card)));
    article.appendChild(copy);
    var action = element('button', '', available ? (card ? 'Open latest card' : 'Open sport') : 'Coming soon');
    action.type = 'button';
    action.disabled = !available;
    if (available) action.addEventListener('click', function () {
      selectLegacySport(item.key);
      openView(card ? 'card' : 'board');
    });
    article.appendChild(action);
    if (full && available) article.dataset.sportKey = item.key;
    return article;
  }
  function renderSports() {
    var preview = clear(one('#pbSportsPreview'));
    var hub = clear(one('#pbSportsHub'));
    var registryNote = one('#pbModelRegistryNote');
    if (registryNote) registryNote.textContent = state.models.length ? state.models.length + ' canonical AEGIS systems are available in the public model registry.' : 'Canonical model information is temporarily unavailable.';
    if (preview) PRIORITY_SPORTS.forEach(function (item) { preview.appendChild(createSportCard(item, false)); });
    if (!hub) return;
    var used = new Set(PRIORITY_SPORTS.map(function (item) { return item.key; }));
    var remaining = state.sports.filter(function (item) { return !used.has(item.key); }).map(function (item) {
      return { title: item.title, key: item.key, monogram: item.title.slice(0, 3).toUpperCase() };
    });
    PRIORITY_SPORTS.concat(remaining).forEach(function (item) { hub.appendChild(createSportCard(item, true)); });
  }
  function tierClass(tier) {
    var normalized = String(tier || 'PASS').toLowerCase();
    return ['core', 'secondary', 'watch', 'pass'].includes(normalized) ? normalized : 'pass';
  }
  function createPlay(play) {
    var tier = String(play.tier || 'PASS').toUpperCase();
    var article = element('article', 'pb-play');
    var top = element('div', 'pb-play-top');
    top.appendChild(element('span', 'pb-tier pb-tier-' + tierClass(tier), tier));
    top.appendChild(element('time', '', marketLabel(play.market)));
    article.appendChild(top);
    article.appendChild(element('h3', '', matchup(play)));
    article.appendChild(element('strong', '', play.selection || 'Published market decision'));
    var detail = [lineAndPrice(play), play.book].filter(Boolean).join(' · ');
    if (detail) article.appendChild(element('p', '', detail));
    return article;
  }
  function currentCard() {
    if (state.selectedCardSport && state.cards.get(state.selectedCardSport)) return state.cards.get(state.selectedCardSport);
    var found = Array.from(state.cards.entries()).find(function (entry) { return !!entry[1]; });
    if (found) { state.selectedCardSport = found[0]; return found[1]; }
    return null;
  }
  function renderCardPreview() {
    var container = clear(one('#pbCardPreview'));
    var selector = clear(one('#pbCardSportSelector'));
    var available = Array.from(state.cards.entries()).filter(function (entry) { return !!entry[1]; });
    if (selector) {
      selector.hidden = available.length < 2;
      available.forEach(function (entry) {
        var button = element('button', entry[0] === state.selectedCardSport ? 'active' : '', sportTitle(entry[0]));
        button.type = 'button';
        button.addEventListener('click', function () { state.selectedCardSport = entry[0]; renderCardPreview(); renderFeatured(); });
        selector.appendChild(button);
      });
    }
    if (!container) return;
    var card = currentCard();
    if (!card) {
      var empty = element('div', 'pb-empty');
      empty.appendChild(element('strong', '', 'No qualified card has been published yet.'));
      empty.appendChild(element('span', '', 'AEGIS will not invent a play when the release gates say Pass.'));
      container.appendChild(empty);
      return;
    }
    var plays = Array.isArray(card.plays) ? card.plays.slice(0, 3) : [];
    var passes = Array.isArray(card.passes) ? card.passes : [];
    if (plays.length) {
      var list = element('div', 'pb-card-list');
      plays.forEach(function (play) { list.appendChild(createPlay(play)); });
      container.appendChild(list);
    } else {
      var noPlays = element('div', 'pb-empty');
      noPlays.appendChild(element('strong', '', 'No qualified card has been published yet.'));
      noPlays.appendChild(element('span', '', 'This card contains no released Core, Secondary, or Watch opportunities.'));
      container.appendChild(noPlays);
    }
    if (passes.length) container.appendChild(element('p', 'pb-pass-note', passes.length + ' Pass decision' + (passes.length === 1 ? '' : 's') + ' remain visible on the full card for transparency.'));
  }
  function renderFeatured() {
    var container = clear(one('#pbFeaturedContent'));
    if (!container) return;
    var card = currentCard();
    var play = card && Array.isArray(card.plays) ? card.plays.find(function (item) { return ['CORE', 'SECONDARY'].includes(String(item.tier || '').toUpperCase()); }) : null;
    if (!play) {
      var neutral = element('div', 'pb-empty');
      neutral.appendChild(element('strong', '', 'What AEGIS is monitoring'));
      neutral.appendChild(element('span', '', 'No current play has cleared the actionable release tiers. Watch and Pass decisions are not presented as recommendations.'));
      container.appendChild(neutral);
      return;
    }
    var copy = element('div');
    copy.appendChild(element('span', 'pb-tier pb-tier-' + tierClass(play.tier), String(play.tier).toUpperCase()));
    copy.appendChild(element('h3', '', matchup(play)));
    copy.appendChild(element('div', 'pb-featured-pick', (play.selection || 'Published selection') + (lineAndPrice(play) ? ' · ' + lineAndPrice(play) : '')));
    if (play.why) copy.appendChild(element('p', 'pb-featured-reason', play.why));
    container.appendChild(copy);
    var facts = element('div', 'pb-featured-facts');
    [['Sport', sportTitle(state.selectedCardSport)], ['Market', marketLabel(play.market)], ['Tier', String(play.tier).toUpperCase()], ['Book', play.book || 'Published market']].forEach(function (pair) {
      var fact = element('div'); fact.appendChild(element('span', '', pair[0])); fact.appendChild(element('b', '', pair[1])); facts.appendChild(fact);
    });
    container.appendChild(facts);
  }
  function resultValue(row) { return String(row && row.result || '').toUpperCase(); }
  function unitReturn(row) {
    var result = resultValue(row);
    var units = Number(row.locked_units !== undefined ? row.locked_units : row.units);
    var price = Number(row.locked_price !== undefined ? row.locked_price : row.price);
    if (!Number.isFinite(units) || units <= 0 || !['WIN', 'LOSS', 'PUSH'].includes(result)) return null;
    if (result === 'LOSS') return -units;
    if (result === 'PUSH') return 0;
    if (!Number.isFinite(price) || price === 0) return null;
    return units * (price > 0 ? price / 100 : 100 / Math.abs(price));
  }
  function renderResults() {
    var container = clear(one('#pbResultsSummary'));
    if (!container) return;
    var graded = state.ledger.filter(function (row) { return ['WIN', 'LOSS', 'PUSH'].includes(resultValue(row)); });
    if (!graded.length) {
      var empty = element('div', 'pb-empty');
      empty.appendChild(element('strong', '', 'Not enough graded results yet.'));
      empty.appendChild(element('span', '', 'Published decisions will appear here after they are graded.'));
      container.appendChild(empty);
      return;
    }
    var wins = graded.filter(function (row) { return resultValue(row) === 'WIN'; }).length;
    var losses = graded.filter(function (row) { return resultValue(row) === 'LOSS'; }).length;
    var pushes = graded.filter(function (row) { return resultValue(row) === 'PUSH'; }).length;
    var returns = graded.map(unitReturn).filter(function (value) { return value !== null; });
    var metrics = [['Graded record', wins + '-' + losses + (pushes ? '-' + pushes : '')], ['Wins', wins], ['Losses', losses], ['Pushes', pushes], ['Recent results', graded.length]];
    if (returns.length) metrics.push(['Graded units', (returns.reduce(function (sum, value) { return sum + value; }, 0) >= 0 ? '+' : '') + returns.reduce(function (sum, value) { return sum + value; }, 0).toFixed(2) + 'u']);
    metrics.forEach(function (metric) {
      var box = element('div', 'pb-result-stat'); box.appendChild(element('span', '', metric[0])); box.appendChild(element('b', '', metric[1])); container.appendChild(box);
    });
  }
  function renderContinue() {
    var section = one('#pbContinue');
    var container = clear(one('#pbContinueContent'));
    if (!section || !container) return;
    var view = safeStorageGet(LAST_VIEW_KEY, null);
    var sport = safeStorageGet(LAST_SPORT_KEY, null);
    var favorites = safeStorageGet(FAVORITES_KEY, []);
    if (!view && !sport && !favorites.length) { section.hidden = true; return; }
    section.hidden = false;
    var label = sport ? 'Continue ' + sportTitle(sport) : favorites.length ? 'Return to your Board favorites' : 'Return to ' + (view === 'card' ? 'Final Card' : view.charAt(0).toUpperCase() + view.slice(1));
    var button = element('button', 'pb-continue-link', label);
    button.type = 'button';
    button.addEventListener('click', function () { if (sport) selectLegacySport(sport); openView(view || (favorites.length ? 'board' : 'sports')); });
    container.appendChild(button);
  }

  function recentPrompts() { return safeStorageGet(RECENT_KEY, []).filter(function (item) { return typeof item === 'string'; }).slice(0, 5); }
  function savePrompt(prompt) {
    var next = [prompt].concat(recentPrompts().filter(function (item) { return item !== prompt; })).slice(0, 5);
    safeStorageSet(RECENT_KEY, next);
    renderRecentPrompts();
  }
  function renderAssistantMessage(role, message, options) {
    options = options || {};
    var messages = one('#pbAskMessages');
    if (!messages) return null;
    var bubble = element('div', 'pb-message pb-message-' + role + (options.state ? ' is-' + options.state : ''));
    bubble.appendChild(element('small', '', role === 'user' ? 'YOU' : 'AEGIS'));
    bubble.appendChild(element('span', '', message));
    if (options.grounded) bubble.appendChild(element('small', 'pb-grounded-badge', 'Grounded in AEGIS'));
    if (options.retry) {
      var retry = element('button', 'pb-retry', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', options.retry);
      bubble.appendChild(retry);
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }
  function renderRecentPrompts() {
    var container = clear(one('#pbRecentPrompts'));
    if (!container) return;
    var prompts = recentPrompts();
    container.hidden = !prompts.length;
    if (!prompts.length) return;
    container.appendChild(element('span', '', 'RECENT'));
    prompts.forEach(function (prompt) {
      var button = element('button', '', prompt); button.type = 'button'; button.addEventListener('click', function () { submitAssistantRequest(prompt, 'page'); }); container.appendChild(button);
    });
  }
  function routeAssistantIntent(rawPrompt) {
    var prompt = String(rawPrompt || '').trim();
    var normalized = prompt.toLowerCase();
    var sport = PRIORITY_SPORTS.find(function (item) { return new RegExp('^(?:open|show|view|explore)\\s+(?:the\\s+)?' + item.title.toLowerCase() + '$').test(normalized); });
    if (sport) {
      if (!sportByKey(sport.key)) return { local: true, view: 'sports', message: sport.title + ' is marked Coming soon because it is not currently represented in the canonical AEGIS sport registry.' };
      return { local: true, view: 'sports', sport: sport.key, message: 'Opening ' + sport.title + '. You can continue to its latest published card or Board from the Sports hub.' };
    }
    if (/^(?:open|show|view)\s+(?:the\s+)?(?:results?|record|ledger)$/.test(normalized)) return { local: true, view: 'results', message: 'Opening the public Results ledger.' };
    if (/^(?:open|show|view)\s+(?:the\s+)?(?:models?|registry)$/.test(normalized)) return { local: true, view: 'models', message: 'Opening the canonical AEGIS model registry.' };
    if (/^(?:open|show|view)\s+(?:the\s+)?(?:final card|today.?s card)$/.test(normalized)) return { local: true, view: 'card', message: 'Opening the latest published AEGIS card. Pass decisions remain visible for transparency.' };
    if (/^(?:open|show|view)\s+(?:the\s+)?(?:board|slate)$/.test(normalized)) return { local: true, view: 'board', message: 'Opening the AEGIS Board.' };
    if (/^(?:open|show|view|explore)\s+(?:the\s+)?sports?$/.test(normalized)) return { local: true, view: 'sports', message: 'Opening the Sports hub.' };
    if (/^(?:explain|show|what are)\s+(?:the\s+)?(?:aegis\s+)?tiers\??$/.test(normalized)) return { local: true, view: null, message: 'CORE and SECONDARY are governed release tiers. WATCH means a confirmation gate remains open. PASS means the opportunity did not clear release requirements and is not a recommendation.' };
    return { local: false };
  }
  function assistantErrorMessage(code) {
    if (code === 'assistant_disabled' || code === 'assistant_unavailable') return 'Ask AEGIS is not enabled yet. The public data pages and deterministic navigation remain available.';
    if (code === 'rate_limited' || code === 'assistant_upstream_rate_limited') return 'Ask AEGIS is at its short-term request limit. Please wait a moment and try again.';
    if (code === 'assistant_credits_exhausted') return 'Ask AEGIS has reached its current usage budget. Please try again later.';
    if (code === 'assistant_timeout') return 'Ask AEGIS took too long to answer. No scan or recommendation was created.';
    if (code === 'assistant_output_limit') return 'Ask AEGIS reached its response limit. Please ask a narrower question.';
    return 'Ask AEGIS could not complete that request safely. Please try again.';
  }
  function setAssistantBusy(busy) {
    state.assistantBusy = busy;
    all('#pbHomeAskForm button, #pbAskForm button').forEach(function (button) { button.disabled = busy; });
  }
  function renderHomeAssistant(message, options) {
    options = options || {};
    var response = clear(one('#pbHomeAskResponse'));
    if (!response) return;
    response.hidden = false;
    response.className = 'pb-inline-response' + (options.state ? ' is-' + options.state : '');
    response.appendChild(element('span', '', message));
    if (options.grounded) response.appendChild(element('small', 'pb-grounded-badge', 'Grounded in AEGIS'));
    if (options.retry) {
      var retry = element('button', 'pb-retry', 'Try again'); retry.type = 'button'; retry.addEventListener('click', options.retry); response.appendChild(retry);
    }
  }
  async function requestAssistant(prompt) {
    var response = await fetch(API.assistant, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, history: state.assistantHistory.slice(-6) })
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(body.error || 'Ask AEGIS is unavailable.'); error.code = body.code; throw error; }
    return body;
  }
  async function submitAssistantRequest(rawPrompt, source) {
    var prompt = String(rawPrompt || '').trim().slice(0, 1000);
    if (!prompt) return;
    if (state.assistantBusy) return;
    savePrompt(prompt);
    var result = routeAssistantIntent(prompt);
    if (result.local) {
      if (source === 'home') renderHomeAssistant(result.message);
      else { renderAssistantMessage('user', prompt); renderAssistantMessage('assistant', result.message); }
      if (result.sport) selectLegacySport(result.sport);
      if (result.view) window.setTimeout(function () { openView(result.view); }, source === 'home' ? 350 : 500);
      return;
    }
    if (source !== 'home') {
      renderAssistantMessage('user', prompt);
      var loading = renderAssistantMessage('assistant', 'Checking published AEGIS intelligence…', { state: 'working' });
    } else renderHomeAssistant('Checking published AEGIS intelligence…', { state: 'working' });
    setAssistantBusy(true);
    try {
      var answer = await requestAssistant(prompt);
      if (loading) loading.remove();
      if (source === 'home') renderHomeAssistant(answer.response, { grounded: answer.grounded === true });
      else renderAssistantMessage('assistant', answer.response, { grounded: answer.grounded === true });
      state.assistantHistory = state.assistantHistory.concat([{ role: 'user', content: prompt }, { role: 'assistant', content: String(answer.response || '') }]).slice(-6);
    } catch (error) {
      if (loading) loading.remove();
      var retry = function () { submitAssistantRequest(prompt, source); };
      var message = assistantErrorMessage(error.code);
      if (source === 'home') renderHomeAssistant(message, { state: 'error', retry: retry });
      else renderAssistantMessage('assistant', message, { state: 'error', retry: retry });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function loadPublicData() {
    var base = await Promise.allSettled([fetchJson(API.sports), fetchJson(API.models), fetchJson(API.results)]);
    state.sports = base[0].status === 'fulfilled' && Array.isArray(base[0].value.sports) ? base[0].value.sports : [];
    state.models = base[1].status === 'fulfilled' && Array.isArray(base[1].value.models) ? base[1].value.models : [];
    state.ledger = base[2].status === 'fulfilled' && Array.isArray(base[2].value.audit) ? base[2].value.audit : [];
    var cardResponses = await Promise.allSettled(state.sports.map(function (sport) { return fetchJson(API.cards + '?sport=' + encodeURIComponent(sport.key)); }));
    state.sports.forEach(function (sport, index) {
      var response = cardResponses[index];
      state.cards.set(sport.key, response && response.status === 'fulfilled' ? response.value.card || null : null);
    });
    var preferred = safeStorageGet(LAST_SPORT_KEY, null);
    state.selectedCardSport = preferred && state.cards.get(preferred) ? preferred : null;
    renderBriefing(); renderSports(); renderCardPreview(); renderFeatured(); renderResults(); renderContinue();
  }
  function bindForms() {
    var homeForm = one('#pbHomeAskForm');
    if (homeForm) homeForm.addEventListener('submit', function (event) { event.preventDefault(); var input = one('#pbHomeAskInput'); submitAssistantRequest(input.value, 'home'); input.value = ''; });
    var askForm = one('#pbAskForm');
    if (askForm) askForm.addEventListener('submit', function (event) { event.preventDefault(); var input = one('#pbAskInput'); submitAssistantRequest(input.value, 'page'); input.value = ''; input.focus(); });
    all('[data-pb-prompt]').forEach(function (button) { button.addEventListener('click', function () { submitAssistantRequest(button.dataset.pbPrompt, one('#home:not(.hidden)') ? 'home' : 'page'); }); });
  }
  function bindNavigation() {
    all('[data-pb-nav]').forEach(function (control) { control.addEventListener('click', function (event) { event.preventDefault(); openView(control.dataset.pbNav); }); });
    all('.navbtn').forEach(function (button) { button.addEventListener('click', function () { queueMicrotask(function () { setViewState(button.dataset.tab); }); }); });
    all('[data-pb-admin]').forEach(function (button) { button.addEventListener('click', function () { var legacy = one('#adminSessionButton'); if (legacy) legacy.click(); }); });
    document.addEventListener('aegis:session-change', function (event) { syncSession(!!(event.detail && event.detail.authenticated)); });
  }
  function start() {
    document.documentElement.classList.add('aegis-public-beta');
    bindNavigation(); bindForms(); renderRecentPrompts();
    renderAssistantMessage('assistant', 'Ready when you are. Ask about published AEGIS cards, plays, results, or model decisions.');
    syncSession(!!(window.ADMIN_SESSION && window.ADMIN_SESSION.authenticated));
    setViewState('home');
    loadPublicData().catch(function () {
      renderBriefing(); renderSports(); renderCardPreview(); renderFeatured(); renderResults(); renderContinue();
    });
  }

  window.AegisPublicBeta = Object.freeze({
    submitAssistantRequest: submitAssistantRequest,
    routeAssistantIntent: routeAssistantIntent,
    renderAssistantMessage: renderAssistantMessage
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
