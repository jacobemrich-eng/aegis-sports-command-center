(function(){
  'use strict';

  const REFRESH_MS=60000;
  let timer=null;

  function text(el,value){
    if(el)el.textContent=value==null?'—':String(value);
  }

  function ensurePanel(){
    let panel=document.getElementById('opsGuardian');
    if(panel)return panel;

    const host=document.querySelector('.autopilotPanel');
    if(!host)return null;

    panel=document.createElement('div');
    panel.id='opsGuardian';
    panel.className='opsGuardian ops-unknown';
    panel.innerHTML=[
      '<div class="opsTop">',
        '<div>',
          '<div class="eyebrow">AUTONOMOUS OPERATIONS</div>',
          '<h3 id="opsTitle">Checking hands-off status…</h3>',
        '</div>',
        '<span id="opsBadge" class="opsBadge">CHECKING</span>',
      '</div>',
      '<p id="opsMessage" class="small subtle">AEGIS is verifying scheduler freshness, persistence, recovery and quota safeguards.</p>',
      '<div class="opsGrid">',
        '<div><b>Last success</b><span id="opsLast">—</span></div>',
        '<div><b>Schedulers</b><span id="opsRecovery">—</span></div>',
        '<div><b>Persistence</b><span id="opsPersist">—</span></div>',
        '<div><b>Quota</b><span id="opsQuota">—</span></div>',
      '</div>',
      '<div id="opsAlerts" class="opsAlerts"></div>'
    ].join('');

    const head=host.querySelector('.sectionhead');
    if(head&&head.nextSibling)host.insertBefore(panel,head.nextSibling);
    else host.appendChild(panel);
    return panel;
  }

  function formatAge(minutes){
    const n=Number(minutes);
    if(!Number.isFinite(n))return 'Not recorded';
    if(n<1)return '<1 min ago';
    return Math.round(n)+' min ago';
  }

  function render(ops){
    const panel=ensurePanel();
    if(!panel||!ops)return;

    const status=String(ops.status||'DEGRADED').toUpperCase();
    const mode=String(ops.mode||'UNKNOWN').replaceAll('_',' ');
    panel.className='opsGuardian ops-'+status.toLowerCase();

    text(document.getElementById('opsBadge'),status);
    text(document.getElementById('opsTitle'),
      status==='GREEN'?'AEGIS IS OPERATING HANDS-OFF':
      status==='RED'?'AEGIS NEEDS ATTENTION':
      mode==='QUOTA PROTECTED'?'AEGIS IS PROTECTING API BUDGET':
      'AEGIS RECOVERY IS ARMED'
    );
    text(document.getElementById('opsMessage'),ops.next_action||'Operational status updated.');
    text(document.getElementById('opsLast'),formatAge(ops.last_success_age_minutes));
    const redundancy=ops.safeguards&&ops.safeguards.scheduler_redundancy;
      const backupStatus=String(redundancy&&redundancy.status||'UNCONFIGURED').toUpperCase();
      const redundantHealthy=redundancy&&redundancy.ready===true&&['HEALTHY','STARTING','RECOVERY_RUNNING'].includes(backupStatus);
      text(document.getElementById('opsRecovery'),
        redundantHealthy?'REDUNDANT':
        redundancy&&redundancy.ready===true?'BACKUP CHECK':
        ops.recovery_armed?'PRIMARY ONLY':'PRIMARY ONLY'
      );
    text(document.getElementById('opsPersist'),ops.safeguards&&ops.safeguards.persistent_state?'CONFIRMED':'CHECK');

    const usage=ops.usage||{};
    const quota=(usage.today!=null&&usage.daily_budget!=null)
      ? `${usage.today}/${usage.daily_budget} today`
      : (ops.quota_protected?'PROTECTED':'GOVERNED');
    text(document.getElementById('opsQuota'),quota);

    const alerts=document.getElementById('opsAlerts');
    if(alerts){
      alerts.replaceChildren();
      const rows=Array.isArray(ops.alerts)?ops.alerts.slice(-3):[];
      if(rows.length){
        for(const item of rows){
          const div=document.createElement('div');
          div.className='opsAlert';
          div.textContent=String(item);
          alerts.appendChild(div);
        }
      }
    }
  }

  async function refresh(){
    try{
      const res=await fetch('/api/health',{cache:'no-store'});
      if(!res.ok)throw new Error('health '+res.status);
      const data=await res.json();
      render(data.operations||null);
    }catch(err){
      const panel=ensurePanel();
      if(panel){
        panel.className='opsGuardian ops-red';
        text(document.getElementById('opsBadge'),'CHECK');
        text(document.getElementById('opsTitle'),'OPERATIONS STATUS UNAVAILABLE');
        text(document.getElementById('opsMessage'),'The dashboard could not verify the live operations contract. Refresh once; if it persists, inspect System Diagnostics.');
      }
    }
  }

  function start(){
    ensurePanel();
    refresh();
    if(timer)clearInterval(timer);
    timer=setInterval(refresh,REFRESH_MS);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')refresh();
  });
})();
