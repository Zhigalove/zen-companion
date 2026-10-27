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
