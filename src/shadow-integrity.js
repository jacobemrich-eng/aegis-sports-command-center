'use strict';

const crypto = require('crypto');

function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Canonical shadow JSON cannot contain non-finite numbers');
  const encoded = JSON.stringify(value);
  if (encoded == null) throw new Error(`Unsupported canonical shadow value: ${typeof value}`);
  return encoded;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

module.exports = { canonicalJson, sha256 };
