const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const release = require('../src/release');
const pkg = require('../package.json');

function greenInput(){
  return {
    storage:{
      ok:true,
      persistent:true
    },

    auto:{
      enabled:true,
      last_error:null
    },

    oddsReady:true,
    cfbdReady:true,
    autopilotSecretReady:true,

    releaseSports:[
      'baseball_mlb',
      'americanfootball_ncaaf'
    ],

    deploy:{
      environment:'production',
      render:true,
      git_commit:'abc123'
    }
  };
}

test(
  'platform release version is v8.9.2 and separate from engine history',
  () => {
    assert.equal(pkg.version, '8.9.2');
    assert.equal(release.APP_VERSION, '8.9.2');

    const engine = require('../src/engine');

    assert.notEqual(
      release.APP_VERSION,
      engine.VERSION
    );
  }
);

test(
  'production health is GREEN when critical services are ready',
  () => {
    const health =
      release.evaluateHealth(greenInput());

    assert.equal(
      health.status,
      'GREEN'
    );

    assert.equal(
      health.ok,
      true
    );

    assert.deepEqual(
      health.failures,
      []
    );

    assert.deepEqual(
      health.warnings,
      []
    );
  }
);

test(
  'missing sportsbook readiness degrades without faking outage',
  () => {
    const input = greenInput();

    input.oddsReady = false;

    const health =
      release.evaluateHealth(input);

    assert.equal(
      health.status,
      'DEGRADED'
    );

    assert.equal(
      health.ok,
      true
    );

    assert.ok(
      health.warnings.includes(
        'sportsbook_feed_not_ready'
      )
    );
  }
);

test(
  'production persistence failure is RED',
  () => {
    const input = greenInput();

    input.storage = {
      ok:false,
      persistent:true
    };

    const health =
      release.evaluateHealth(input);

    assert.equal(
      health.status,
      'RED'
    );

    assert.equal(
      health.ok,
      false
    );

    assert.ok(
      health.failures.includes(
        'storage_unhealthy'
      )
    );
  }
);

test(
  'production ephemeral storage is RED',
  () => {
    const input = greenInput();

    input.storage = {
      ok:true,
      persistent:false
    };

    const health =
      release.evaluateHealth(input);

    assert.equal(
      health.status,
      'RED'
    );

    assert.ok(
      health.failures.includes(
        'persistent_storage_required'
      )
    );
  }
);

test(
  'health route exposes release, engine and Render identity',
  () => {
    const server =
      fs.readFileSync(
        path.join(ROOT, 'server.js'),
        'utf8'
      );

    assert.match(
      server,
      /release\.buildHealth/
    );

    assert.match(
      server,
      /version:release\.APP_VERSION/
    );

    assert.match(
      server,
      /engineVersion:engine\.VERSION/
    );

    assert.match(
      server,
      /release_version:release\.APP_VERSION/
    );
  }
);

test(
  'server source contains no old bullet mojibake',
  () => {
    const server =
      fs.readFileSync(
        path.join(ROOT, 'server.js'),
        'utf8'
      );

    assert.equal(
      server.includes('â€¢'),
      false
    );
  }
);
