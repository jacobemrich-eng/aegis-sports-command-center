'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const s=require('../src/gametwin-statcast');

test('CSV parser handles quoted player names and numeric fields',()=>{
  const rows=s.parseCsv('"last_name, first_name",player_id,brl_percent\n"Ohtani, Shohei",660271,16.7\n');
  assert.equal(rows.length,1);assert.equal(rows[0]['last_name, first_name'],'Ohtani, Shohei');assert.equal(rows[0].player_id,'660271');
});

test('Statcast bundle joins contact, expected stats and pitch-type rows by MLBAM id',()=>{
  const bundle=s.buildBundle({
    batterContact:[{player_id:'1',ev95percent:'48.2',brl_percent:'13.1',avg_hit_speed:'91.3'}],
    batterExpected:[{player_id:'1',est_woba:'.381',woba:'.360'}],
    batterArsenal:[{player_id:'1',pitch_type:'FF',pitch_usage:'35.0',whiff_percent:'18.0',est_woba:'.420'}],
    pitcherContact:[{player_id:'2',ev95percent:'34.0',brl_percent:'5.0',avg_hit_speed:'87.0'}],
    pitcherExpected:[{player_id:'2',est_woba:'.285',woba:'.300',xera:'3.05'}],
    pitcherArsenal:[{player_id:'2',pitch_type:'FF',pitch_usage:'55.0',whiff_percent:'28.0',est_woba:'.270'}]
  });
  assert.equal(bundle.batters.get(1).statcast.xwoba,.381);
  assert.equal(bundle.pitchers.get(2).statcast.xwoba_allowed,.285);
  assert.equal(bundle.pitchers.get(2).arsenal[0].pitch_type,'FF');
});
