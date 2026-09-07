'use strict';

const SPORT_KEY = 'baseball_mlb';

function adapt() {
  const error = new Error('MLB simulator adapter is reserved for the concurrent MLB workstream; MLB internals were not modified');
  error.code = 'MLB_ADAPTER_NOT_IMPLEMENTED';
  throw error;
}

module.exports = { SPORT_KEY, adapt };
