'use strict';

const fs=require('fs');
const path=require('path');

const VERSION='0.4.0-audit-store';

function createMemoryAuditStore(){const rows=new Map();return {VERSION,async save(snapshot){rows.set(snapshot.snapshot_id,snapshot);return snapshot;},async get(id){return rows.get(id)||null;},async list(){return [...rows.values()];},async update(snapshot){rows.set(snapshot.snapshot_id,snapshot);return snapshot;},async clear(){rows.clear();}};}
function createJsonlAuditStore(filePath){if(!filePath)throw new Error('GameTwin JSONL audit store requires a file path');const file=path.resolve(filePath);async function ensure(){await fs.promises.mkdir(path.dirname(file),{recursive:true});}
  async function readAll(){try{const raw=await fs.promises.readFile(file,'utf8'),latest=new Map();for(const line of raw.split(/\r?\n/)){if(!line.trim())continue;try{const row=JSON.parse(line);if(row?.snapshot_id)latest.set(row.snapshot_id,row);}catch{}}return [...latest.values()];}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async function append(row){await ensure();await fs.promises.appendFile(file,JSON.stringify(row)+'\n','utf8');return row;}
  return {VERSION,file,save:append,update:append,async get(id){return (await readAll()).find(x=>x.snapshot_id===id)||null;},list:readAll};}
function createAegisStateAuditStore(aegisStore,options={}){if(!aegisStore||typeof aegisStore.mutate!=='function'||typeof aegisStore.load!=='function')throw new Error('GameTwin AEGIS audit store requires the existing AEGIS store module');const cap=Math.max(100,Math.min(5000,Number(options.cap||1200)));function ensure(state){state.gametwin=state.gametwin&&typeof state.gametwin==='object'?state.gametwin:{};state.gametwin.audit_snapshots=state.gametwin.audit_snapshots&&typeof state.gametwin.audit_snapshots==='object'?state.gametwin.audit_snapshots:{};state.gametwin.audit_order=Array.isArray(state.gametwin.audit_order)?state.gametwin.audit_order:[];return state.gametwin;}async function upsert(snapshot){await aegisStore.mutate(state=>{const g=ensure(state),id=snapshot.snapshot_id;g.audit_snapshots[id]=snapshot;g.audit_order=g.audit_order.filter(x=>x!==id);g.audit_order.push(id);while(g.audit_order.length>cap){const old=g.audit_order.shift();delete g.audit_snapshots[old];}g.updated_at=new Date().toISOString();return id;});return snapshot;}return {VERSION,save:upsert,update:upsert,async get(id){const s=await aegisStore.load(),g=ensure(s);return g.audit_snapshots[id]||null;},async list(){const s=await aegisStore.load(),g=ensure(s);return g.audit_order.map(id=>g.audit_snapshots[id]).filter(Boolean);}};}
module.exports={VERSION,createMemoryAuditStore,createJsonlAuditStore,createAegisStateAuditStore};
