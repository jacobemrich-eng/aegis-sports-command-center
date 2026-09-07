'use strict';

const SPORT_KEY = 'americanfootball_ncaaf';

function adapt() {
  const error = new Error('NCAAF simulator adapter is reserved but not implemented; production NCAAF remains unchanged');
  error.code = 'NCAAF_ADAPTER_NOT_IMPLEMENTED';
  throw error;
}

module.exports = { SPORT_KEY, adapt };
