const test=require('node:test');
const assert=require('node:assert/strict');
const sgo=require('../src/odds-secondary-sgo');
const router=require('../src/provider-router');

test('secondary adapter accepts only supported MLB/NCAAF slate endpoints',()=>{
  assert.equal(sgo.canHandle('sports/baseball_mlb/odds?markets=h2h,spreads,totals'),true);
  assert.equal(sgo.canHandle('sports/americanfootball_ncaaf/odds?markets=h2h'),true);
  assert.equal(sgo.canHandle('sports/baseball_mlb/events/abc/odds?markets=h2h'),false);
  assert.equal(sgo.canHandle('sports/basketball_wnba/odds?markets=h2h'),false);
});

test('secondary allowlist omits unavailable books without changing the primary bookmaker request',()=>{
  const primaryBooks='hardrockbet_fl,fanduel,draftkings,fanatics';
  const p=sgo.parseEndpoint(`sports/baseball_mlb/odds?bookmakers=${primaryBooks}&markets=h2h`);
  assert.deepEqual(sgo.config({}).bookmakerAllowlist,[
    'fanduel','draftkings','betmgm','caesars','espnbet','bovada','unibet','pointsbet','williamhill'
  ]);
  assert.deepEqual(p.primaryBooks,primaryBooks.split(','));
  assert.deepEqual(p.sgoBooks,['fanduel','draftkings']);
  assert.deepEqual(p.secondaryPrimaryBooks,['fanduel','draftkings']);
  assert.equal(p.leagueID,'MLB');
});

test('secondary request sends only configurable SportsGameOdds bookmaker IDs',async()=>{
  const env={
    AEGIS_ODDS_SECONDARY_ENABLED:'true',
    SPORTSGAMEODDS_API_KEY:'test-secret',
    AEGIS_ODDS_SECONDARY_BASE_URL:'https://secondary.test/v2',
    AEGIS_ODDS_SECONDARY_BOOKMAKER_ALLOWLIST:'draftkings,caesars'
  };
  const originalFetch=global.fetch;
  let requestedUrl;
  global.fetch=async url=>{
    requestedUrl=new URL(String(url));
    return new Response(JSON.stringify({success:true,data:[]}),{status:200});
  };

  try{
    await sgo.fetchOdds('sports/baseball_mlb/odds?bookmakers=hardrockbet_fl,fanduel,draftkings,caesars&markets=h2h',{env});
    assert.equal(requestedUrl.searchParams.get('bookmakerID'),'draftkings,caesars');
    assert.equal(requestedUrl.searchParams.get('bookmakerID').includes('hardrockbet'),false);
  }finally{
    global.fetch=originalFetch;
  }
});

test('SportsGameOdds fixture normalizes into AEGIS/The-Odds-API shape',()=>{
  const parsed=sgo.parseEndpoint('sports/baseball_mlb/odds?bookmakers=hardrockbet_fl,fanduel&markets=h2h,spreads,totals');
  const fixture={
    eventID:'abc',
    status:{startsAt:'2026-09-12T23:00:00Z',cancelled:false,ended:false},
    teams:{
      home:{names:{medium:'Home Club'}},
      away:{names:{medium:'Away Club'}}
    },
    odds:{
      'points-home-game-ml-home':{
        periodID:'game',betTypeID:'ml',sideID:'home',
        byBookmaker:{fanduel:{odds:'-120',available:true,lastUpdatedAt:'2026-09-12T20:00:00Z'}}
      },
      'points-away-game-ml-away':{
        periodID:'game',betTypeID:'ml',sideID:'away',
        byBookmaker:{fanduel:{odds:'+105',available:true,lastUpdatedAt:'2026-09-12T20:00:01Z'}}
      },
      'points-home-game-sp-home':{
        periodID:'game',betTypeID:'sp',sideID:'home',
        byBookmaker:{fanduel:{odds:'-110',spread:'-1.5',available:true}}
      },
      'points-away-game-sp-away':{
        periodID:'game',betTypeID:'sp',sideID:'away',
        byBookmaker:{fanduel:{odds:'-110',spread:'+1.5',available:true}}
      },
      'points-all-game-ou-over':{
        periodID:'game',betTypeID:'ou',sideID:'over',
        byBookmaker:{fanduel:{odds:'-105',overUnder:'8.5',available:true}}
      },
      'points-all-game-ou-under':{
        periodID:'game',betTypeID:'ou',sideID:'under',
        byBookmaker:{fanduel:{odds:'-115',overUnder:'8.5',available:true}}
      }
    }
  };

  const out=sgo.normalizeEvent(fixture,parsed);
  assert.equal(out.home_team,'Home Club');
  assert.equal(out.away_team,'Away Club');
  assert.equal(out.bookmakers[0].key,'fanduel');

  const markets=Object.fromEntries(out.bookmakers[0].markets.map(m=>[m.key,m]));
  assert.equal(markets.h2h.outcomes.length,2);
  assert.equal(markets.spreads.outcomes.find(x=>x.name==='Home Club').point,-1.5);
  assert.equal(markets.totals.outcomes.find(x=>x.name==='Over').point,8.5);
});

test('MLB and NCAAF failover still normalize valid events from supported secondary books',async()=>{
  const env={
    AEGIS_ODDS_SECONDARY_ENABLED:'true',
    SPORTSGAMEODDS_API_KEY:'secondary-test-secret',
    AEGIS_ODDS_SECONDARY_BASE_URL:'https://secondary.test/v2',
    ODDS_API_KEY:'primary-test-secret',
    AEGIS_ODDS_PRIMARY_BASE_URL:'https://primary.test/v4'
  };
  const originalFetch=global.fetch;
  const secondaryUrls=[];
  global.fetch=async url=>{
    if(String(url).startsWith(env.AEGIS_ODDS_PRIMARY_BASE_URL)){
      return new Response(JSON.stringify({error:'retryable primary failure'}),{status:503});
    }
    secondaryUrls.push(new URL(String(url)));
    const sport=secondaryUrls.at(-1).searchParams.get('leagueID')==='MLB'?'baseball_mlb':'americanfootball_ncaaf';
    return new Response(JSON.stringify({success:true,data:[{
      eventID:`${sport}-event`,
      status:{startsAt:'2026-09-14T17:00:00Z',cancelled:false,ended:false},
      teams:{home:{names:{medium:'Home'}},away:{names:{medium:'Away'}}},
      odds:{
        home:{periodID:'game',betTypeID:'ml',sideID:'home',byBookmaker:{fanduel:{odds:'-110',available:true}}},
        away:{periodID:'game',betTypeID:'ml',sideID:'away',byBookmaker:{fanduel:{odds:'-105',available:true}}}
      }
    }]}),{status:200});
  };

  try{
    for(const sport of ['baseball_mlb','americanfootball_ncaaf']){
      router.resetForTest();
      const result=await router.fetchOdds(`sports/${sport}/odds?bookmakers=hardrockbet_fl,fanduel&markets=h2h`,{env});
      assert.equal(result.meta.route,'secondary');
      assert.equal(result.data.length,1);
      assert.equal(result.data[0].sport_key,sport);
      assert.equal(result.data[0].bookmakers[0].key,'fanduel');
    }
    assert.equal(secondaryUrls.length,2);
    assert.ok(secondaryUrls.every(url=>url.searchParams.get('bookmakerID')==='fanduel'));
  }finally{
    global.fetch=originalFetch;
    router.resetForTest();
  }
});

test('secondary stays dormant without a key',()=>{
  const st=sgo.publicStatus({
    AEGIS_ODDS_SECONDARY_ENABLED:'true',
    SPORTSGAMEODDS_API_KEY:''
  });
  assert.equal(st.enabled,true);
  assert.equal(st.configured,false);
});

test('router exposes circuit-breaker state without secrets',()=>{
  router.resetForTest();
  const st=router.status({
    AEGIS_ODDS_SECONDARY_ENABLED:'true',
    SPORTSGAMEODDS_API_KEY:'secret-test'
  });
  assert.equal(st.mode,'primary_with_secondary_failover');
  assert.equal(st.secondary.configured,true);
  assert.equal('apiKey' in st.secondary,false);
});
