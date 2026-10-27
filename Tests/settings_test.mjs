import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let settings, modified=0, ack;
const style=new Map();
globalThis.Ci={nsIFile:{}};
globalThis.Services={
 dirsvc:{get:()=>({path:'/profile'})},
 prefs:{setStringPref(){},setBoolPref(){},clearUserPref(){}},
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
const fills=[...css.matchAll(/max\(25%, calc\(100% - var\(--lg-transparency\)(?: \* (\.94))?\)\)/g)];
assert.equal(fills.length,5,'Every adjustable material must retain a minimum fill');
for(const [,factor] of fills){
 const fill=t=>Math.max(25,100-t*Number(factor??1));
 assert.equal(fill(0),100);
 assert.equal(fill(100),25);
 assert.ok(fill(40)>fill(100));
}
console.log('PASS: 100 -> 40 -> 0 -> 70 without a Zen Mods holder; material retains fill');

const overlaySelector=':root:is([zen-compact-mode="true"], [macOSNativeFullscreen], [sizemode="fullscreen"], [inDOMFullscreen]):not([customizing]) #navigator-toolbox';
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
const floatingFill=css.match(/var\(--lg-nav-tint\) calc\(100% - var\(--lg-transparency\) \* (\.08)\)/);
assert.ok(floatingFill,'Floating navigation must remain readable without remote blur');
for(const transparency of [0,40,100])assert.ok(100-transparency*Number(floatingFill[1])>=92);
console.log('PASS: floating sidebar material excludes slide-out gutters and includes padding in its saved width');
