const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { MODELS } = require('./src/models');
const { runAegis } = require('./src/aegis');

function loadEnv(){
  const p = path.join(__dirname,'.env');
  if(!fs.existsSync(p)) return;
  for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){
    if(!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx=line.indexOf('='); const k=line.slice(0,idx).trim(); const v=line.slice(idx+1).trim();
    if(!(k in process.env)) process.env[k]=v;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const REGION = process.env.ODDS_REGION || 'us';
const publicDir = path.join(__dirname,'public');

const sportsFallback = [
  {key:'baseball_mlb',title:'MLB',group:'Baseball'},
  {key:'baseball_kbo',title:'KBO League',group:'Baseball'},
  {key:'baseball_npb',title:'NPB',group:'Baseball'},
  {key:'americanfootball_nfl_preseason',title:'NFL Preseason',group:'American Football'},
  {key:'americanfootball_nfl',title:'NFL',group:'American Football'},
  {key:'americanfootball_ncaaf',title:'NCAAF',group:'American Football'},
  {key:'basketball_wnba',title:'WNBA',group:'Basketball'}
];

function send(res,status,data,type='application/json'){
  res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store'});
  res.end(type==='application/json' ? JSON.stringify(data) : data);
}
async function readBody(req){
  return await new Promise((resolve,reject)=>{
    let s=''; req.on('data',d=>{s+=d;if(s.length>1e6)req.destroy();}); req.on('end',()=>resolve(s)); req.on('error',reject);
  });
}
async function oddsFetch(endpoint){
  if(!ODDS_KEY) throw new Error('ODDS_API_KEY is not configured. Copy .env.example to .env and add your key.');
  const join = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.the-odds-api.com/v4/${endpoint}${join}apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r = await fetch(url, {headers:{'User-Agent':'AEGIS-Sports-Command-Center/1.0'}});
  const text = await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok) throw new Error(data.message || data.error || `Odds API ${r.status}`);
  return {data, meta:{remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last')}};
}

async function weatherFetch(lat,lon){
  const headers={'User-Agent':'AEGIS-Sports-Command-Center/1.0 (local research app)','Accept':'application/geo+json'};
  const p = await fetch(`https://api.weather.gov/points/${lat},${lon}`,{headers});
  if(!p.ok) throw new Error(`NWS points ${p.status}`);
  const pj = await p.json();
  const u = pj?.properties?.forecastHourly || pj?.properties?.forecast;
  if(!u) throw new Error('No forecast URL returned by NWS.');
  const fr = await fetch(u,{headers}); if(!fr.ok) throw new Error(`NWS forecast ${fr.status}`);
  return await fr.json();
}

function mime(file){
  return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json'})[path.extname(file)] || 'application/octet-stream';
}

const server = http.createServer(async (req,res)=>{
  try{
    const u = new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname==='/api/health') return send(res,200,{ok:true,oddsConfigured:!!ODDS_KEY,region:REGION,models:MODELS.length,time:new Date().toISOString()});
    if(u.pathname==='/api/models') return send(res,200,{models:MODELS.map(([name,category,purpose],id)=>({id:id+1,name,category,purpose}))});
    if(u.pathname==='/api/sports'){
      if(!ODDS_KEY) return send(res,200,{live:false,sports:sportsFallback,notice:'Configure ODDS_API_KEY for live in-season discovery.'});
      const x=await oddsFetch('sports?all=true'); return send(res,200,{live:true,sports:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/odds'){
      const sport=u.searchParams.get('sport')||'upcoming';
      const markets=u.searchParams.get('markets')||'h2h,spreads,totals';
      const bookmakers=u.searchParams.get('bookmakers');
      const scope = bookmakers ? `bookmakers=${encodeURIComponent(bookmakers)}` : `regions=${encodeURIComponent(REGION)}`;
      const x=await oddsFetch(`sports/${encodeURIComponent(sport)}/odds?${scope}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`);
      return send(res,200,{live:true,events:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/scores'){
      const sport=u.searchParams.get('sport')||'americanfootball_nfl';
      const days=Math.max(1,Math.min(3,Number(u.searchParams.get('daysFrom')||1)));
      const x=await oddsFetch(`sports/${encodeURIComponent(sport)}/scores?daysFrom=${days}&dateFormat=iso`);
      return send(res,200,{live:true,scores:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/weather'){
      const lat=u.searchParams.get('lat'), lon=u.searchParams.get('lon');
      if(!lat||!lon) return send(res,400,{error:'lat and lon are required'});
      return send(res,200,{live:true,forecast:await weatherFetch(lat,lon)});
    }
    if(u.pathname==='/api/analyze' && req.method==='POST'){
      const body=JSON.parse(await readBody(req)||'{}');
      if(!body.event) return send(res,400,{error:'event is required'});
      return send(res,200,runAegis(body));
    }

    let rel = u.pathname==='/' ? 'index.html' : u.pathname.replace(/^\//,'');
    const file=path.normalize(path.join(publicDir,rel));
    if(!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res,404,{error:'Not found'});
    send(res,200,fs.readFileSync(file),mime(file));
  }catch(err){ send(res,500,{error:err.message||String(err)}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS Sports Command Center running on port ${PORT}`));
