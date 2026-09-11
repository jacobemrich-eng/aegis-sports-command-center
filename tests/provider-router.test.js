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

test('primary bookmaker names map to SportsGameOdds IDs',()=>{
  const p=sgo.parseEndpoint('sports/baseball_mlb/odds?bookmakers=hardrockbet_fl,fanduel,draftkings&markets=h2h');
  assert.deepEqual(p.sgoBooks,['hardrockbet','fanduel','draftkings']);
  assert.equal(p.leagueID,'MLB');
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
        byBookmaker:{hardrockbet:{odds:'-120',available:true,lastUpdatedAt:'2026-09-12T20:00:00Z'}}
      },
      'points-away-game-ml-away':{
        periodID:'game',betTypeID:'ml',sideID:'away',
        byBookmaker:{hardrockbet:{odds:'+105',available:true,lastUpdatedAt:'2026-09-12T20:00:01Z'}}
      },
      'points-home-game-sp-home':{
        periodID:'game',betTypeID:'sp',sideID:'home',
        byBookmaker:{hardrockbet:{odds:'-110',spread:'-1.5',available:true}}
      },
      'points-away-game-sp-away':{
        periodID:'game',betTypeID:'sp',sideID:'away',
        byBookmaker:{hardrockbet:{odds:'-110',spread:'+1.5',available:true}}
      },
      'points-all-game-ou-over':{
        periodID:'game',betTypeID:'ou',sideID:'over',
        byBookmaker:{hardrockbet:{odds:'-105',overUnder:'8.5',available:true}}
      },
      'points-all-game-ou-under':{
        periodID:'game',betTypeID:'ou',sideID:'under',
        byBookmaker:{hardrockbet:{odds:'-115',overUnder:'8.5',available:true}}
      }
    }
  };

  const out=sgo.normalizeEvent(fixture,parsed);
  assert.equal(out.home_team,'Home Club');
  assert.equal(out.away_team,'Away Club');
  assert.equal(out.bookmakers[0].key,'hardrockbet_fl');

  const markets=Object.fromEntries(out.bookmakers[0].markets.map(m=>[m.key,m]));
  assert.equal(markets.h2h.outcomes.length,2);
  assert.equal(markets.spreads.outcomes.find(x=>x.name==='Home Club').point,-1.5);
  assert.equal(markets.totals.outcomes.find(x=>x.name==='Over').point,8.5);
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
