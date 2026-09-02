from pathlib import Path

path = Path("public/app.js")
s = path.read_text()

if "function eventTimeLabel(iso)" in s:
    raise SystemExit(
        "Final Card time UI is already installed. No changes made."
    )

old_exec = """function execHtml(p){var dq=p.data_quality_grade||p.data_freshness?.grade||'—';return '<div class="executionbox"><div class="autostatus"><span class="freshness '+esc(dq)+'">DATA '+esc(dq)+'</span><span class="small subtle">Quote age '+(p.data_freshness?.quote_age_minutes==null?'—':Math.round(p.data_freshness.quote_age_minutes)+'m')+'</span></div><div class="executiongrid"><div class="execitem"><b>Play-To</b><strong>'+fmtA(p.play_to)+'</strong></div><div class="execitem"><b>Downgrade</b><strong>'+fmtA(p.downgrade_at)+'</strong></div><div class="execitem"><b>Pass</b><strong>'+fmtA(p.pass_at)+'</strong></div></div></div>'}"""

new_exec = """function eventTimeLabel(iso){
  if(!iso)return 'Time TBD';
  var d=new Date(iso);
  if(!Number.isFinite(d.getTime()))return 'Time TBD';

  var tz='America/New_York',
      now=new Date(),
      dayFmt=new Intl.DateTimeFormat(
        'en-US',
        {
          timeZone:tz,
          year:'numeric',
          month:'2-digit',
          day:'2-digit'
        }
      ),
      key=dayFmt.format(d),
      today=dayFmt.format(now),
      tomorrow=dayFmt.format(
        new Date(now.getTime()+86400000)
      ),
      prefix=
        key===today
          ?'Today'
          :key===tomorrow
            ?'Tomorrow'
            :new Intl.DateTimeFormat(
              'en-US',
              {
                timeZone:tz,
                weekday:'short',
                month:'short',
                day:'numeric'
              }
            ).format(d),
      time=new Intl.DateTimeFormat(
        'en-US',
        {
          timeZone:tz,
          hour:'numeric',
          minute:'2-digit'
        }
      ).format(d);

  return prefix+' • '+time+' ET';
}

function quoteFreshnessText(p){
  var q=p.data_freshness?.quote_age_minutes;

  if(q==null)return 'Snapshot age at scan —';

  var age=Math.max(0,Math.round(q)),
      start=p.event?.commence_time||p.commence_time,
      mins=start
        ?(new Date(start).getTime()-Date.now())/60000
        :Infinity,
      suffix='';

  if(mins>360){
    suffix=' • next refresh scheduled';
  }else if(mins>120){
    suffix=' • monitoring';
  }else if(mins>0){
    suffix=' • final window';
  }

  return 'Snapshot age at scan '+age+'m'+suffix;
}

function execHtml(p){var dq=p.data_quality_grade||p.data_freshness?.grade||'—';return '<div class="executionbox"><div class="autostatus"><span class="freshness '+esc(dq)+'">DATA '+esc(dq)+'</span><span class="small subtle">'+esc(quoteFreshnessText(p))+'</span></div><div class="executiongrid"><div class="execitem"><b>Play-To</b><strong>'+fmtA(p.play_to)+'</strong></div><div class="execitem"><b>Downgrade</b><strong>'+fmtA(p.downgrade_at)+'</strong></div><div class="execitem"><b>Pass</b><strong>'+fmtA(p.pass_at)+'</strong></div></div></div>'}"""

count = s.count(old_exec)

if count != 1:
    raise SystemExit(
        f"execHtml target: expected 1 match, found {count}"
    )

s = s.replace(old_exec, new_exec, 1)

old_header = """<span class="matchup">'+esc(p.event.away_team)+' @ '+esc(p.event.home_team)+'</span></div>'+tierCall(p)+'"""

new_header = """<span class="matchup">'+esc(p.event.away_team)+' @ '+esc(p.event.home_team)+'</span><div class="small subtle" style="margin-top:6px">'+esc(eventTimeLabel(p.event?.commence_time||p.commence_time))+'</div></div>'+tierCall(p)+'"""

v8_marker = "/* ===== AEGIS v8 AUTOPILOT OVERRIDES ===== */"

marker_pos = s.find(v8_marker)

if marker_pos == -1:
    raise SystemExit(
        "AEGIS v8 override marker was not found."
    )

before_v8 = s[:marker_pos]
v8 = s[marker_pos:]

count = v8.count(old_header)

if count != 1:
    raise SystemExit(
        f"v8 play header target: expected 1 match, found {count}"
    )

v8 = v8.replace(old_header, new_header, 1)

s = before_v8 + v8

path.write_text(s)

print(
    "Final Card date/time and freshness UI patch applied."
)
