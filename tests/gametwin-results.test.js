'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const r=require('../src/gametwin-results');

test('innings pitched baseball notation converts to outs',()=>{assert.equal(r.inningsToOuts('5.2'),17);assert.equal(r.inningsToOuts('6.0'),18);assert.equal(r.inningsToOuts('0.1'),1);});

test('final feed parser extracts scores and player/pitcher box stats',()=>{
  const feed={gamePk:99,gameData:{status:{abstractGameState:'Final',detailedState:'Final'},teams:{away:{id:1,name:'Braves'},home:{id:2,name:'Nationals'}}},liveData:{linescore:{teams:{away:{runs:5},home:{runs:3}}},boxscore:{teams:{away:{players:{ID1:{person:{fullName:'Hitter A'},stats:{batting:{plateAppearances:4,atBats:4,hits:2,doubles:1,triples:0,homeRuns:1,runs:2,rbi:2,baseOnBalls:0,strikeOuts:1}}},ID2:{person:{fullName:'Pitcher A'},stats:{pitching:{inningsPitched:'6.2',strikeOuts:7,baseOnBalls:2,hits:5,homeRuns:1,earnedRuns:2,runs:2,numberOfPitches:101}}}}},home:{players:{}}}}}};
  const out=r.parseFinalFeed(feed);assert.equal(out.final,true);assert.deepEqual(out.score,{away:5,home:3});assert.equal(out.players.away['Hitter A'].TB,6);assert.equal(out.pitchers.away['Pitcher A'].OUTS,20);
});
