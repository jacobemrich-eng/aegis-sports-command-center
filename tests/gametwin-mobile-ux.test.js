'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('mobile UX layer provides swipe navigation and timeline seeking',()=>{const s=read('public/gametwin-mobile-ux.js');assert.match(s,/touchstart/);assert.match(s,/touchend/);assert.match(s,/nextPA/);assert.match(s,/prevPA/);assert.match(s,/gtmTimeline/);assert.match(s,/\.seek\?/);});

test('mobile UX provides fullscreen focus with orientation best-effort fallback',()=>{const s=read('public/gametwin-mobile-ux.js');assert.match(s,/requestFullscreen/);assert.match(s,/gt-mobile-focus/);assert.match(s,/orientation\?\.lock/);assert.match(s,/orientation\?\.unlock/);});

test('mobile UX exposes compact scorebug and collapsible play-by-play drawer',()=>{const s=read('public/gametwin-mobile-ux.js'),css=read('public/gametwin.css');assert.match(s,/gt-mobile-scorebug/);assert.match(s,/gt-pbp-drawer/);assert.match(s,/toggleDrawer/);assert.match(css,/\.gt-mobile-scorebug/);assert.match(css,/\.gt-pbp-drawer\.open/);});

test('mobile UX matchup panel compares GameTwin AEGIS and market without granting authority',()=>{const s=read('public/gametwin-mobile-ux.js');assert.match(s,/AEGIS vs GameTwin/);assert.match(s,/GameTwin/);assert.match(s,/AEGIS/);assert.match(s,/Market/);assert.match(s,/shadow-only/);});

test('mobile broadcast focus uses safe-area and landscape-specific styling',()=>{const css=read('public/gametwin.css');assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/100dvh/);assert.match(css,/orientation:portrait/);assert.match(css,/gt-rotate-hint/);});
