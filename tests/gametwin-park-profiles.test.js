'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('path');
async function mod(){return import(path.join(__dirname,'..','public','gametwin-park-profiles.mjs'));}
test('park identity library covers at least 30 MLB venue profiles',async()=>{const p=await mod();assert.ok(p.PARK_PROFILES.length>=30);assert.equal(p.profileForVenue('Minute Maid Park').name,'Daikin Park');assert.equal(p.profileForVenue('Guaranteed Rate Field').name,'Rate Field');});
test('park aliases preserve distinctive presentation cues',async()=>{const p=await mod();assert.ok(p.profileForVenue('Fenway Park').landmarks.includes('tall_left_wall'));assert.ok(p.profileForVenue('Oracle Park').landmarks.includes('right_field_water'));assert.ok(p.profileForVenue('Wrigley Field').landmarks.includes('ivy_wall'));});
test('unknown venue gets a safe generic profile',async()=>{const p=await mod(),x=p.parkProfileSummary('Future Neutral Park');assert.equal(x.matched,false);assert.equal(x.bowl,'generic');assert.ok(x.landmarks.includes('center_board'));});
