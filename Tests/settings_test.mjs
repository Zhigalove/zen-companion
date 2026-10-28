import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let settings, modified=0, ack;
const preferences=new Map();
const style=new Map();
globalThis.Ci={nsIFile:{}};
globalThis.Services={
 dirsvc:{get:()=>({path:'/profile'})},
 prefs:{setStringPref(k,v){preferences.set(k,v)},setBoolPref(){},clearUserPref(){}},
 wm:{getEnumerator:()=>[{document:{documentElement:{style:{setProperty:(k,v)=>style.set(k,v)}},getElementById:()=>null}}]},
 appinfo:{version:'test',appBuildID:'build'}
};
globalThis.IOUtils={stat:async()=>({lastModified:modified}),readJSON:async()=>settings,writeJSON:async(p,s)=>{ack=s}};
const {readSettings}=await import('../Resources/Payload/video-companion/AppSettings.sys.mjs');
for(const transparency of [100,40,0,70]){
 settings={schema:1,enabled:true,transparency,revision:String(++modified),testedZen:[{version:'test',buildID:'build'}]};
 await readSettings();
 assert.equal(style.get('--lg-transparency'),transparency+'%');
 assert.equal(ack.transparency,transparency);
 assert.equal(ack.revision,settings.revision);
}
const css=await readFile(new URL('../Resources/Payload/chrome.css',import.meta.url),'utf8');
const fills=[...css.matchAll(/max\(4%, calc\(100% - var\(--lg-transparency\) \* (1\.285714)\)\)/g)];
assert.equal(fills.length,5,'Every adjustable material must retain a minimum fill');
for(const [,factor] of fills){
 const fill=t=>Math.max(4,100-t*Number(factor??1));
 assert.equal(fill(0),100);
 assert.equal(fill(100),4);
 assert.ok(fill(40)>fill(100));
}
console.log('PASS: 100 -> 40 -> 0 -> 70 without a Zen Mods holder; material retains fill');

const overlaySelector=':root:is([zen-compact-mode="true"], [inDOMFullscreen]):not([customizing]) #navigator-toolbox';
const frame=css.slice(css.lastIndexOf(overlaySelector+' {'));
const gutter=frame.slice(0,frame.indexOf('}'));
assert.ok(gutter.includes('background: transparent !important;'));
assert.ok(gutter.includes('box-shadow: none !important;'));
const materialRule=css.slice(css.indexOf(overlaySelector+' #titlebar {'));
const material=materialRule.slice(0,materialRule.indexOf('}'));
assert.ok(material.includes('background: var(--lg-surface) !important;'));
assert.ok(material.includes('backdrop-filter: var(--lg-filter) !important;'));
assert.ok(material.includes('box-sizing: border-box !important;'));
assert.ok(material.includes('box-shadow: inset 0 0 0 1px var(--lg-edge), var(--lg-shadow) !important;'));
assert.ok(frame.includes(overlaySelector+' .zen-toolbar-background {\n  display: none !important;'));
assert.ok(css.lastIndexOf(overlaySelector+' {')>css.indexOf(':root[inDOMFullscreen] #navigator-toolbox .zen-toolbar-background'));
assert.ok(!css.includes('var(--lg-transparency) * .08'),'Floating navigation must not override the shared opacity curve');
console.log('PASS: floating sidebar material excludes slide-out gutters and includes padding in its saved width');

assert.ok(!css.includes(':root:is([zen-compact-mode="true"], [macOSNativeFullscreen], [sizemode="fullscreen"], [inDOMFullscreen])'));
console.log('PASS: native fullscreen alone cannot enable the floating sidebar material');

for(const appearance of ['universal','glass',undefined,'invalid']){
 settings={...settings,appearance,revision:String(++modified)};
 await readSettings();
 assert.equal(preferences.get('mod.zenliquid.appearance'),appearance==='universal'?'universal':'glass');
 assert.equal(ack.appearance,appearance==='universal'?'universal':'glass');
}
console.log('PASS: appearance switches live and legacy settings retain glass');

const universal=css.slice(css.indexOf('/* Optional neutral material.'));
assert.ok(universal.includes('text-shadow: none !important;'));
assert.ok(!universal.includes('drop-shadow('));
assert.ok(universal.includes(':root zen-library #zen-library-side,'));
assert.ok(universal.includes('blur(10px) saturate(172%) brightness(.67)'));
assert.ok(universal.includes('var(--lg-live-backdrop)'));
assert.ok(!universal.includes('--lg-tint: #24262b'));
assert.ok(!universal.includes('light-dark('));
assert.ok(!universal.includes('-moz-system-dark-theme'));
console.log('PASS: universal palette is independent of system theme');
