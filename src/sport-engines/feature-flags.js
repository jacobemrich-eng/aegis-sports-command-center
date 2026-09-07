'use strict';

function enabled(name, fallback) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function flags() {
  return Object.freeze({
    NFL_SIM_ENABLED: enabled('NFL_SIM_ENABLED', true),
    NFL_SIM_SHADOW_ONLY: enabled('NFL_SIM_SHADOW_ONLY', true),
    NCAAF_SIM_ENABLED: enabled('NCAAF_SIM_ENABLED', false),
    NCAAF_SIM_SHADOW_ONLY: enabled('NCAAF_SIM_SHADOW_ONLY', true),
    MLB_SIM_ENABLED: enabled('MLB_SIM_ENABLED', false),
    MLB_SIM_SHADOW_ONLY: enabled('MLB_SIM_SHADOW_ONLY', true),
    AEGIS_NEW_ENGINE_AUTO_RELEASE: enabled('AEGIS_NEW_ENGINE_AUTO_RELEASE', false)
  });
}

module.exports = { enabled, flags };
