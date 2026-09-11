const test=require('node:test');
const assert=require('node:assert/strict');
const cache=require('../src/provider-cache');
const provider=require('../src/odds-provider');

test('provider cache IDs are deterministic and namespaced',()=>{
  const a=cache.cacheId('sports/baseball_mlb/odds');
  const b=cache.cacheId('sports/baseball_mlb/odds');
  const c=cache.cacheId('sports/americanfootball_ncaaf/odds');
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/provider-/);
});

test('provider cache round trips in process memory',async()=>{
  cache.resetMemory();
  const key='test|memory';
  const value={data:[{id:'g1'}],meta:{provider:'test'},fetched_at:new Date().toISOString()};
  const saved=await cache.set(key,value);
  assert.equal(saved.ok,true);
  const got=await cache.get(key);
  assert.deepEqual(got,value);
});

test('provider adapter builds encoded primary URL',()=>{
  const cfg={name:'the_odds_api',baseUrl:'https://example.test/v4',apiKey:'a b',timeoutMs:10000};
  const url=provider.endpointUrl('sports/baseball_mlb/odds?markets=h2h',cfg);
  assert.equal(url,'https://example.test/v4/sports/baseball_mlb/odds?markets=h2h&apiKey=a%20b');
});

test('provider retry policy is limited to transient classes',()=>{
  assert.equal(provider.retryable({status:429}),true);
  assert.equal(provider.retryable({status:503}),true);
  assert.equal(provider.retryable({status:401}),false);
  assert.equal(provider.retryable({status:422}),false);
});
