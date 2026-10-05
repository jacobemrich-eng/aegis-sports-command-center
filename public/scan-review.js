(function () {
  'use strict';

  var button = document.getElementById('scan');
  var dialog = document.getElementById('scanReviewDialog');
  var form = document.getElementById('scanReviewForm');
  var approval = document.getElementById('scanReviewApproval');
  var confirmButton = document.getElementById('scanReviewConfirm');
  var cancelButton = document.getElementById('scanReviewCancel');
  var runConfirmedScan = window.runScan;

  if (!button || !dialog || !form || !approval || !confirmButton || !cancelButton || typeof runConfirmedScan !== 'function') return;

  function text(id, value) {
    var target = document.getElementById(id);
    if (target) target.textContent = value;
  }

  function selectedSport() {
    var key = document.getElementById('sport').value;
    var sports = Array.isArray(window.SPORTS) ? window.SPORTS : [];
    return sports.find(function (sport) { return sport.key === key; }) || { key: key, title: key || 'Unknown sport' };
  }

  function updateReview() {
    var sport = selectedSport();
    var markets = document.getElementById('markets');
    var readiness = document.querySelector('#sportReadiness b');
    var events = Array.isArray(window.EVENTS) ? window.EVENTS : [];
    var syncedAt = Number(window.BOARD_SYNCED_AT || 0);
    var ageMs = syncedAt ? Math.max(0, Date.now() - syncedAt) : null;
    var quota = window.QUOTA;
    var snapshot;

    text('scanReviewSport', sport.title);
    text('scanReviewCoverage', readiness ? readiness.textContent : 'Coverage details unavailable');
    text('scanReviewMarkets', markets && markets.selectedOptions[0] ? markets.selectedOptions[0].textContent.trim() : 'Default markets');

    if (!events.length) snapshot = 'No local board snapshot. Confirming will sync the board first.';
    else if (ageMs === null) snapshot = events.length + ' games cached; timestamp unavailable. AEGIS may refresh before scanning.';
    else if (ageMs > 120000) snapshot = 'Stale (' + Math.round(ageMs / 60000) + 'm old). Confirming will refresh the board first.';
    else snapshot = 'Fresh (' + Math.max(0, Math.round(ageMs / 60000)) + 'm old) · ' + events.length + ' games. AEGIS will refresh if it becomes stale.';
    text('scanReviewSnapshot', snapshot);

    if (quota && quota.remaining !== undefined && quota.remaining !== null) {
      text('scanReviewQuota', String(quota.remaining) + ' remaining at last odds check');
    } else {
      text('scanReviewQuota', 'Checked when the board refreshes');
    }

    approval.checked = false;
    confirmButton.disabled = true;
  }

  button.textContent = 'REVIEW SCAN';
  button.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    updateReview();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', 'open');
    cancelButton.focus();
  }, true);

  approval.addEventListener('change', function () {
    confirmButton.disabled = !approval.checked;
  });

  cancelButton.addEventListener('click', function () {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });

  dialog.addEventListener('close', function () {
    approval.checked = false;
    confirmButton.disabled = true;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!approval.checked || confirmButton.disabled) return;
    confirmButton.disabled = true;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    runConfirmedScan();
  });
})();
