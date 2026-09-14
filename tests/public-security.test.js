const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

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
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!=null)throw new Error(`test server exited with ${child.exitCode}`);
    try{const response=await fetch(`${url}/api/health`);if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('test server did not start');
}

async function startServer(t,overrides={}){
  const port=await freePort(),url=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{
    cwd:ROOT,
    env:{
      ...process.env,
      PORT:String(port),
      NODE_ENV:'test',
      AEGIS_ACCESS_PIN:'security-test-pin',
      AEGIS_SESSION_SECRET:'security-test-session-secret',
      AEGIS_AUTOPILOT_SECRET:'security-test-autopilot-secret',
      AEGIS_HEARTBEAT_SECRET:'security-test-heartbeat-secret',
      AEGIS_AUTOPILOT_ENABLED:'false',
      SUPABASE_URL:'',
      SUPABASE_SECRET_KEY:'',
      SUPABASE_SERVICE_ROLE_KEY:'',
      ...overrides
    },
    stdio:'ignore'
  });
  t.after(()=>{if(child.exitCode==null)child.kill();});
  await waitForServer(url,child);
  return {url,child};
}

async function authenticate(url){
  const response=await fetch(`${url}/api/login`,{
    method:'POST',
    headers:{Origin:url,'Content-Type':'application/json'},
    body:JSON.stringify({pin:'security-test-pin'})
  });
  assert.equal(response.status,200);
  const body=await response.json();
  return {
    cookie:String(response.headers.get('set-cookie')||'').split(';')[0],
    csrf:body.csrf_token,
    expiresAt:body.expires_at,
    setCookie:String(response.headers.get('set-cookie')||'')
  };
}

test('operator login is rendered in-app without a native prompt',()=>{
  const app=fs.readFileSync(path.join(ROOT,'public','app.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
  assert.doesNotMatch(app,/\bprompt\s*\(/);
  assert.match(html,/id="loginDialog"/);
  assert.match(html,/id="adminSessionButton"/);
  assert.match(app,/\/api\/logout/);
});

test('public read routes remain available and public health is minimal',async t=>{
  const {url}=await startServer(t);
  for(const route of ['/api/health','/api/models','/api/sports','/api/cards/latest?sport=baseball_mlb','/api/results/ledger']){
    const response=await fetch(`${url}${route}`);
    assert.equal(response.status,200,route);
  }
  const health=await (await fetch(`${url}/api/health`)).json();
  assert.deepEqual(Object.keys(health).sort(),['ok','service','status']);
  assert.equal(JSON.stringify(health).includes('provider'),false);
  for(const key of ['persistent_storage','storage_backend','odds_ready','provider_router','provider_cache','daily_odds_budget','autopilot_secret_ready']){
    assert.equal(key in health,false,key);
  }
  assert.deepEqual(await (await fetch(`${url}/api/session`)).json(),{authenticated:false});
  assert.deepEqual(await (await fetch(`${url}/api/session`,{headers:{Cookie:'aegis_session=invalid'}})).json(),{authenticated:false});
});

test('admin routes reject unauthenticated users and fail closed without both credentials',async t=>{
  const configured=await startServer(t);
  assert.equal((await fetch(`${configured.url}/api/admin/status`)).status,401);
  assert.equal((await fetch(`${configured.url}/api/operations/status`)).status,401);
  assert.equal((await fetch(`${configured.url}/api/odds`)).status,401);
  assert.equal((await fetch(`${configured.url}/api/scan`,{method:'POST'})).status,401);

  const missingPin=await startServer(t,{AEGIS_ACCESS_PIN:'',AEGIS_SESSION_SECRET:'configured-secret'});
  const missingSecret=await startServer(t,{AEGIS_ACCESS_PIN:'security-test-pin',AEGIS_SESSION_SECRET:''});
  for(const server of [missingPin,missingSecret]){
    assert.equal((await fetch(`${server.url}/api/admin/status`)).status,503);
    assert.equal((await fetch(`${server.url}/api/scan`,{method:'POST'})).status,503);
  }
  const unavailable=[];
  for(const server of [missingPin,missingSecret]){
    const response=await fetch(`${server.url}/api/login`,{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:'{}'});
    unavailable.push({status:response.status,body:await response.json()});
  }
  assert.deepEqual(unavailable[0],unavailable[1]);
  assert.equal(unavailable[0].status,503);
  assert.doesNotMatch(JSON.stringify(unavailable[0].body),/pin|session.secret/i);
});

test('successful login rotates random session and CSRF values, and logout revokes the current session',async t=>{
  const {url}=await startServer(t);
  const auth=await authenticate(url);
  const firstToken=decodeURIComponent(auth.cookie.split('=')[1]),firstId=firstToken.split('.')[1];
  assert.match(firstId,/^[A-Za-z0-9_-]{32}$/);
  assert.match(auth.csrf,/^[A-Za-z0-9_-]{32}$/);
  assert.match(auth.setCookie,/HttpOnly/i);
  assert.match(auth.setCookie,/SameSite=Strict/i);
  assert.match(auth.setCookie,/Path=\//i);
  assert.match(auth.setCookie,/Max-Age=28800/i);
  const remainingMs=new Date(auth.expiresAt).getTime()-Date.now();
  assert.ok(remainingMs<=8*60*60*1000&&remainingMs>7.9*60*60*1000);

  const httpsOrigin=url.replace('http://','https://');
  const secureLogin=await fetch(`${url}/api/login`,{
    method:'POST',
    headers:{Origin:httpsOrigin,'X-Forwarded-Proto':'https','Content-Type':'application/json'},
    body:JSON.stringify({pin:'security-test-pin'})
  });
  assert.equal(secureLogin.status,200);
  assert.match(String(secureLogin.headers.get('set-cookie')||''),/; Secure/i);

  assert.equal((await fetch(`${url}/api/admin/status`,{headers:{Cookie:auth.cookie}})).status,200);
  const session=await (await fetch(`${url}/api/session`,{headers:{Cookie:auth.cookie}})).json();
  assert.equal(session.authenticated,true);
  assert.equal(session.csrf_token,auth.csrf);

  const rotatedResponse=await fetch(`${url}/api/login`,{
    method:'POST',
    headers:{Origin:url,Cookie:auth.cookie,'Content-Type':'application/json'},
    body:JSON.stringify({pin:'security-test-pin'})
  });
  assert.equal(rotatedResponse.status,200);
  const rotatedBody=await rotatedResponse.json(),rotatedCookie=String(rotatedResponse.headers.get('set-cookie')||'').split(';')[0];
  const rotatedId=decodeURIComponent(rotatedCookie.split('=')[1]).split('.')[1];
  assert.notEqual(rotatedId,firstId);
  assert.notEqual(rotatedBody.csrf_token,auth.csrf);
  assert.equal((await fetch(`${url}/api/admin/status`,{headers:{Cookie:auth.cookie}})).status,401);
  assert.equal((await fetch(`${url}/api/admin/status`,{headers:{Cookie:rotatedCookie}})).status,200);

  const logout=await fetch(`${url}/api/logout`,{
    method:'POST',
    headers:{Origin:url,Cookie:rotatedCookie,'X-AEGIS-CSRF':rotatedBody.csrf_token,'Content-Type':'application/json'},
    body:'{}'
  });
  assert.equal(logout.status,200);
  assert.equal((await fetch(`${url}/api/admin/status`,{headers:{Cookie:rotatedCookie}})).status,401);
});

test('login requires same-origin metadata and enforces eight attempts per IP per 15 minutes',async t=>{
  const {url}=await startServer(t);
  const missingOrigin=await fetch(`${url}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'security-test-pin'})});
  assert.equal(missingOrigin.status,403);
  const validReferer=await fetch(`${url}/api/login`,{method:'POST',headers:{Referer:`${url}/`,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.21'},body:JSON.stringify({pin:'security-test-pin'})});
  assert.equal(validReferer.status,200);

  for(let attempt=0;attempt<8;attempt++){
    const response=await fetch(`${url}/api/login`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.20'},body:JSON.stringify({pin:'wrong'})});
    assert.equal(response.status,401,`attempt ${attempt+1}`);
  }
  const limited=await fetch(`${url}/api/login`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.20'},body:JSON.stringify({pin:'security-test-pin'})});
  assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('retry-after'))>0);
});

test('malformed login JSON returns a controlled error without parser details',async t=>{
  const {url}=await startServer(t);
  const response=await fetch(`${url}/api/login`,{
    method:'POST',
    headers:{Origin:url,'Content-Type':'application/json'},
    body:'{'
  });
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'Invalid request.',code:'invalid_request'});
  const source=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
  assert.match(source,/error:'Internal server error',code:'internal_server_error'/);
  assert.doesNotMatch(source,/send\(res,500,\{error:e\.message/);
});

test('server session and rate registries remain bounded and evict oldest entries',async t=>{
  const {url}=await startServer(t);
  let firstCookie='',lastCookie='';
  for(let index=0;index<513;index++){
    const response=await fetch(`${url}/api/login`,{
      method:'POST',
      headers:{Origin:url,'Content-Type':'application/json','X-Forwarded-For':`198.51.${Math.floor(index/250)}.${index%250+1}`},
      body:JSON.stringify({pin:'security-test-pin'})
    });
    assert.equal(response.status,200,`login ${index+1}`);
    const cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
    if(index===0)firstCookie=cookie;
    lastCookie=cookie;
  }
  assert.deepEqual(await (await fetch(`${url}/api/session`,{headers:{Cookie:firstCookie}})).json(),{authenticated:false});
  assert.equal((await (await fetch(`${url}/api/session`,{headers:{Cookie:lastCookie}})).json()).authenticated,true);

  for(let attempt=0;attempt<8;attempt++){
    const response=await fetch(`${url}/api/login`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Forwarded-For':'198.51.0.1'},body:JSON.stringify({pin:'wrong'})});
    assert.equal(response.status,401,`reintroduced rate key attempt ${attempt+1}`);
  }
  assert.equal((await fetch(`${url}/api/login`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Forwarded-For':'198.51.0.1'},body:JSON.stringify({pin:'wrong'})})).status,429);
  const source=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
  assert.match(source,/const MAX_RATE_ENTRIES = 512/);
  assert.match(source,/row\.start\+row\.windowMs<=now/);
});

test('CSRF and origin protections reject unsafe browser mutations',async t=>{
  const {url}=await startServer(t);
  const auth=await authenticate(url);
  const base={method:'POST',headers:{Cookie:auth.cookie,'Content-Type':'application/json'},body:'{}'};

  const noCsrf=await fetch(`${url}/api/not-a-route`,{...base,headers:{...base.headers,Origin:url}});
  assert.equal(noCsrf.status,403);
  assert.equal((await noCsrf.json()).code,'invalid_csrf');
  const wrongCsrf=await fetch(`${url}/api/not-a-route`,{...base,headers:{...base.headers,Origin:url,'X-AEGIS-CSRF':'not-the-session-token'}});
  assert.equal(wrongCsrf.status,403);
  assert.equal((await wrongCsrf.json()).code,'invalid_csrf');
  const noOrigin=await fetch(`${url}/api/not-a-route`,{...base,headers:{...base.headers,'X-AEGIS-CSRF':auth.csrf}});
  assert.equal(noOrigin.status,403);
  assert.equal((await noOrigin.json()).code,'invalid_origin');

  const crossSite=await fetch(`${url}/api/not-a-route`,{...base,headers:{...base.headers,Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site','X-AEGIS-CSRF':auth.csrf}});
  assert.equal(crossSite.status,403);
  assert.equal((await crossSite.json()).code,'invalid_origin');

  const safe=await fetch(`${url}/api/not-a-route`,{...base,headers:{...base.headers,Origin:url,'X-AEGIS-CSRF':auth.csrf}});
  assert.equal(safe.status,404);

  for(const route of ['/api/logout','/api/scan','/api/card/lock','/api/results/grade','/api/results/resolve','/api/admin/diagnostics/provider-failover','/api/autopilot/tick']){
    const response=await fetch(`${url}${route}`,{...base,headers:{...base.headers,Origin:url}});
    assert.equal(response.status,403,route);
    assert.equal((await response.json()).code,'invalid_csrf',route);
  }

  const crossSiteLogin=await fetch(`${url}/api/login`,{method:'POST',headers:{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},body:JSON.stringify({pin:'security-test-pin'})});
  assert.equal(crossSiteLogin.status,403);
});

test('heartbeat and Autopilot bearer routes remain machine-to-machine compatible',async t=>{
  const {url}=await startServer(t);
  const auth=await authenticate(url);

  const heartbeatWithCookie=await fetch(`${url}/api/autopilot/heartbeat`,{method:'POST',headers:{Cookie:auth.cookie}});
  assert.equal(heartbeatWithCookie.status,401);
  const heartbeatWithAutopilotSecret=await fetch(`${url}/api/autopilot/heartbeat`,{method:'POST',headers:{Authorization:'Bearer security-test-autopilot-secret'}});
  assert.equal(heartbeatWithAutopilotSecret.status,401);

  const tickWithCookieOnly=await fetch(`${url}/api/autopilot/tick`,{method:'POST',headers:{Origin:url,Cookie:auth.cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal(tickWithCookieOnly.status,403);
  assert.equal((await tickWithCookieOnly.json()).code,'invalid_csrf');
  const tickWithHeartbeatSecret=await fetch(`${url}/api/autopilot/tick`,{method:'POST',headers:{Authorization:'Bearer security-test-heartbeat-secret','Content-Type':'application/json'},body:'{}'});
  assert.equal(tickWithHeartbeatSecret.status,401);
  const statusWithHeartbeatSecret=await fetch(`${url}/api/autopilot/status`,{headers:{Authorization:'Bearer security-test-heartbeat-secret'}});
  assert.equal(statusWithHeartbeatSecret.status,401);

  const heartbeat=await fetch(`${url}/api/autopilot/heartbeat`,{
    method:'POST',
    headers:{Authorization:'Bearer security-test-heartbeat-secret'}
  });
  assert.equal(heartbeat.status,200);

  const status=await fetch(`${url}/api/autopilot/status`,{
    headers:{Authorization:'Bearer security-test-autopilot-secret'}
  });
  assert.equal(status.status,200);

  const tick=await fetch(`${url}/api/autopilot/tick`,{
    method:'POST',
    headers:{Origin:'https://attacker.example',Authorization:'Bearer security-test-autopilot-secret','Content-Type':'application/json'},
    body:'{}'
  });
  assert.equal(tick.status,200);
  assert.deepEqual(await tick.json(),{ok:false,disabled:true});
});

test('Autopilot workflow keeps read-only permissions and never logs its bearer value',()=>{
  const workflow=fs.readFileSync(path.join(ROOT,'.github','workflows','aegis-autopilot.yml'),'utf8');
  assert.match(workflow,/permissions:\s*\r?\n\s+contents: read/);
  assert.doesNotMatch(workflow,/permissions:[\s\S]*?contents: write/);
  const secretExpansions=workflow.split(/\r?\n/).filter(line=>line.includes('${AUTOPILOT_SECRET}'));
  assert.ok(secretExpansions.length>=3);
  for(const line of secretExpansions)assert.match(line,/Authorization: Bearer/);
  assert.match(workflow,/\/api\/autopilot\/tick/);
  assert.match(workflow,/\/api\/autopilot\/status/);
  assert.match(workflow,/Date\.parse\(j\.last_success_at\|\|''\)/);
  assert.doesNotMatch(workflow,/last_autopilot_success/);
});
