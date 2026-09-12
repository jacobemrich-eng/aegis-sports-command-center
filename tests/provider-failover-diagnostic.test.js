const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const router=require('../src/provider-router');

const ROOT=path.join(__dirname,'..');

function secondaryFixture(){
  return {
    eventID:'diagnostic-event',
    status:{startsAt:'2026-09-13T23:00:00Z',cancelled:false,ended:false},
    teams:{
      home:{names:{medium:'Home Club'}},
      away:{names:{medium:'Away Club'}}
    },
    odds:{
      home:{
        periodID:'game',betTypeID:'ml',sideID:'home',
        byBookmaker:{
          hardrockbet:{odds:'-120',available:true},
          fanduel:{odds:'-118',available:true}
        }
      },
      away:{
        periodID:'game',betTypeID:'ml',sideID:'away',
        byBookmaker:{
          hardrockbet:{odds:'+105',available:true},
          fanduel:{odds:'+102',available:true}
        }
      }
    }
  };
}

function diagnosticEnv(){
  return {
    AEGIS_ODDS_SECONDARY_ENABLED:'true',
    SPORTSGAMEODDS_API_KEY:'secondary-test-secret',
    AEGIS_ODDS_SECONDARY_BASE_URL:'https://secondary.test/v2',
    ODDS_API_KEY:'primary-test-secret',
    AEGIS_ODDS_PRIMARY_BASE_URL:'https://primary.test/v4'
  };
}

test('simulated primary failure reaches the real secondary normalization path without changing router state',async()=>{
  router.resetForTest();
  const env=diagnosticEnv();
  const before=router.status(env);
  const originalFetch=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),headers:options.headers||{}});
    return new Response(JSON.stringify({success:true,data:[secondaryFixture()]}),{
      status:200,
      headers:{'Content-Type':'application/json'}
    });
  };

  try{
    const result=await router.diagnoseFailover({
      sport:'baseball_mlb',
      markets:'h2h,spreads,totals',
      bookmakers:'hardrockbet_fl,fanduel'
    },{env});

    assert.equal(result.success,true);
    assert.equal(result.provider_used,'sportsgameodds');
    assert.equal(result.route,'diagnostic_secondary_failover');
    assert.equal(result.normalized_event_count,1);
    assert.equal(result.bookmaker_count,2);
    assert.equal(result.hard_rock_bet_present,true);
    assert.equal(result.production_route_untouched,true);
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/secondary\.test\/v2\/events/);
    assert.equal(calls[0].headers['x-api-key'],env.SPORTSGAMEODDS_API_KEY);
    assert.deepEqual(router.status(env),before);
  }finally{
    global.fetch=originalFetch;
  }
});

test('diagnostic fails when normalization produces no usable events',async()=>{
  router.resetForTest();
  const env=diagnosticEnv();
  const originalFetch=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({success:true,data:[]}),{status:200});

  try{
    const result=await router.diagnoseFailover({sport:'baseball_mlb',markets:'h2h'},{env});
    assert.equal(result.success,false);
    assert.equal(result.error,'no_usable_normalized_events');
    assert.equal(result.normalized_event_count,0);
    assert.equal(result.bookmaker_count,0);
    assert.equal(result.hard_rock_bet_present,false);
    assert.equal(result.production_route_untouched,true);
    assert.equal(typeof result.elapsed_ms,'number');
  }finally{
    global.fetch=originalFetch;
  }
});

test('diagnostic fails when normalized events contain no usable bookmakers',async()=>{
  router.resetForTest();
  const env=diagnosticEnv();
  const secondary=require('../src/odds-secondary-sgo');
  const originalFetchOdds=secondary.fetchOdds;
  secondary.fetchOdds=async()=>({data:[{id:'normalized-event',bookmakers:[]}]});

  try{
    const result=await router.diagnoseFailover({sport:'americanfootball_ncaaf',markets:'totals'},{env});
    assert.equal(result.success,false);
    assert.equal(result.error,'no_usable_normalized_bookmakers');
    assert.equal(result.normalized_event_count,1);
    assert.equal(result.bookmaker_count,0);
    assert.equal(result.hard_rock_bet_present,false);
    assert.equal(result.production_route_untouched,true);
    assert.equal(typeof result.elapsed_ms,'number');
  }finally{
    secondary.fetchOdds=originalFetchOdds;
  }
});

test('normal production routing remains primary after a diagnostic',async()=>{
  router.resetForTest();
  const env=diagnosticEnv();
  const originalFetch=global.fetch;
  const urls=[];
  global.fetch=async(url)=>{
    urls.push(String(url));
    if(String(url).startsWith(env.AEGIS_ODDS_SECONDARY_BASE_URL)){
      return new Response(JSON.stringify({success:true,data:[secondaryFixture()]}),{status:200});
    }
    return new Response(JSON.stringify([]),{
      status:200,
      headers:{'x-requests-remaining':'99','x-requests-used':'1','x-requests-last':'1'}
    });
  };

  try{
    const endpoint='sports/baseball_mlb/odds?bookmakers=hardrockbet_fl&markets=h2h,spreads,totals';
    const diagnostic=await router.diagnoseFailover({
      sport:'baseball_mlb',
      markets:'h2h,spreads,totals',
      bookmakers:'hardrockbet_fl'
    },{env});
    assert.equal(diagnostic.success,true);

    const production=await router.fetchOdds(endpoint,{env});
    assert.equal(production.meta.route,'primary');
    assert.equal(production.meta.failover,false);
    assert.equal(router.status(env).last_route,'primary');
    assert.ok(urls.some(url=>url.startsWith(env.AEGIS_ODDS_PRIMARY_BASE_URL)));
  }finally{
    global.fetch=originalFetch;
  }
});

test('diagnostic rejects unsupported sports and markets',async()=>{
  await assert.rejects(
    router.diagnoseFailover({sport:'basketball_wnba',markets:'h2h'}),
    error=>error?.status===400&&error?.code==='unsupported_sport'
  );
  await assert.rejects(
    router.diagnoseFailover({sport:'americanfootball_ncaaf',markets:'h2h,player_props'}),
    error=>error?.status===400&&error?.code==='unsupported_markets'
  );
});

test('diagnostic failure response never exposes provider secrets or raw errors',async()=>{
  router.resetForTest();
  const env=diagnosticEnv();
  const originalFetch=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({
    success:false,
    error:`upstream echoed ${env.SPORTSGAMEODDS_API_KEY} and ${env.ODDS_API_KEY}`
  }),{status:500});

  try{
    const result=await router.diagnoseFailover({sport:'americanfootball_ncaaf',markets:['h2h']},{env});
    const encoded=JSON.stringify(result);
    assert.equal(result.success,false);
    assert.equal(result.error,'secondary_request_failed');
    assert.equal(result.production_route_untouched,true);
    assert.equal(encoded.includes(env.SPORTSGAMEODDS_API_KEY),false);
    assert.equal(encoded.includes(env.ODDS_API_KEY),false);
    assert.equal('data' in result,false);
    assert.equal('headers' in result,false);
    assert.equal('environment' in result,false);
  }finally{
    global.fetch=originalFetch;
  }
});

function freePort(){
  return new Promise((resolve,reject)=>{
    const socket=net.createServer();
    socket.once('error',reject);
    socket.listen(0,'127.0.0.1',()=>{
      const {port}=socket.address();
      socket.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function waitForServer(url,child){
  for(let attempt=0;attempt<50;attempt++){
    if(child.exitCode!=null)throw new Error(`test server exited with ${child.exitCode}`);
    try{
      const response=await fetch(`${url}/api/health`);
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('test server did not start');
}

test('diagnostic endpoint requires authentication and is aggressively rate limited',async t=>{
  const port=await freePort();
  const url=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{
    cwd:ROOT,
    env:{
      ...process.env,
      PORT:String(port),
      NODE_ENV:'test',
      AEGIS_ACCESS_PIN:'diagnostic-test-pin',
      AEGIS_SESSION_SECRET:'diagnostic-test-session-secret',
      SPORTSGAMEODDS_API_KEY:'',
      SUPABASE_URL:'',
      SUPABASE_SECRET_KEY:'',
      SUPABASE_SERVICE_ROLE_KEY:''
    },
    stdio:'ignore'
  });
  t.after(()=>{if(child.exitCode==null)child.kill();});
  await waitForServer(url,child);

  const body=JSON.stringify({sport:'baseball_mlb',markets:'h2h,spreads,totals'});
  const unauthorized=await fetch(`${url}/api/admin/diagnostics/provider-failover`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body
  });
  assert.equal(unauthorized.status,401);

  const login=await fetch(`${url}/api/login`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pin:'diagnostic-test-pin'})
  });
  assert.equal(login.status,200);
  const cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
  assert.match(cookie,/^aegis_session=/);

  const statuses=[];
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(`${url}/api/admin/diagnostics/provider-failover`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Cookie:cookie},
      body
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses,[502,502,429]);
});
