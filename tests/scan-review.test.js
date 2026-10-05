const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'public/scan-review.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

function makeElement(initial) {
  const listeners = {};
  return Object.assign({
    listeners,
    addEventListener(type, listener) { listeners[type] = listener; },
    focus() {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    showModal() { this.isOpen = true; },
    close() { this.isOpen = false; if (listeners.close) listeners.close(); }
  }, initial || {});
}

test('Scan Desk review is required before the existing scan runner can be reached', () => {
  const button = makeElement();
  const dialog = makeElement();
  const form = makeElement();
  const approval = makeElement({ checked: false });
  const confirm = makeElement({ disabled: true });
  const cancel = makeElement();
  const sport = { value: 'baseball_mlb' };
  const markets = { selectedOptions: [{ textContent: 'Full game markets' }] };
  const coverage = { textContent: 'PRODUCTION RESEARCH' };
  const values = {
    scan: button,
    scanReviewDialog: dialog,
    scanReviewForm: form,
    scanReviewApproval: approval,
    scanReviewConfirm: confirm,
    scanReviewCancel: cancel,
    sport,
    markets,
    scanReviewSport: makeElement(),
    scanReviewCoverage: makeElement(),
    scanReviewMarkets: makeElement(),
    scanReviewSnapshot: makeElement(),
    scanReviewQuota: makeElement()
  };
  let scans = 0;
  const document = {
    getElementById(id) { return values[id] || null; },
    querySelector(selector) { return selector === '#sportReadiness b' ? coverage : null; }
  };
  const window = {
    SPORTS: [{ key: 'baseball_mlb', title: 'MLB' }],
    EVENTS: [{ id: 'game-1' }],
    BOARD_SYNCED_AT: Date.now() - 30000,
    QUOTA: { remaining: 12 },
    runScan() { scans += 1; }
  };

  vm.runInNewContext(source, { document, window, Date, Array, String, Math });

  let prevented = false;
  let stopped = false;
  button.listeners.click({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(button.textContent, 'REVIEW SCAN');
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(dialog.isOpen, true);
  assert.equal(scans, 0);
  assert.match(values.scanReviewSport.textContent, /MLB/);
  assert.match(values.scanReviewSnapshot.textContent, /Fresh/);
  assert.match(values.scanReviewQuota.textContent, /12 remaining/);
  assert.equal(confirm.disabled, true);

  cancel.listeners.click();
  assert.equal(dialog.isOpen, false);
  assert.equal(scans, 0);
  assert.equal(approval.checked, false);

  button.listeners.click({ preventDefault() {}, stopImmediatePropagation() {} });
  approval.checked = true;
  approval.listeners.change();
  assert.equal(confirm.disabled, false);
  let submitted = false;
  form.listeners.submit({ preventDefault() { submitted = true; } });
  assert.equal(submitted, true);
  assert.equal(dialog.isOpen, false);
  assert.equal(scans, 1);
});

test('scan review disclosure and controls are present in the authenticated command UI', () => {
  assert.match(html, /id="scanReviewDialog"/);
  assert.match(html, /id="scanReviewApproval" type="checkbox"/);
  assert.match(html, /id="scanReviewConfirm"[^>]*disabled/);
  assert.match(html, /This does not place a bet/);
  assert.match(html, /scan-review\.js\?v=9\.6\.0/);
  assert.doesNotMatch(source, /fetch\s*\(|\/api\//);
});
