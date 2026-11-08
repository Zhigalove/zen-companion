import assert from 'node:assert/strict';
globalThis.JSWindowActorChild=class{};
globalThis.Services={prefs:{getBoolPref:()=>true}};
const {UltimateGlassVideoChild}=await import('../Resources/Payload/video-companion/VideoChild.sys.mjs');
const a=new UltimateGlassVideoChild();let opacity='0',hit;
const rect={left:0,top:0,right:1000,bottom:600,width:1000,height:600};
const panel={isConnected:true,getBoundingClientRect:()=>rect,parentElement:null,getRootNode:()=>({host:null})};
const root={contains:n=>n===video,querySelector:s=>s.endsWith('button')?{}:panel};
const video={isConnected:true,matches:()=>true,closest:s=>s==='.aon-fs-ui'?root:null,getBoundingClientRect:()=>rect};
hit=video;a.presentationVideo={get:()=>video};
a.contentWindow={innerWidth:1000,innerHeight:600,mozInnerScreenX:0,mozInnerScreenY:0,devicePixelRatio:2,getComputedStyle:n=>n===panel?{opacity,visibility:'visible',display:'flex'}:{cursor:'pointer'}};
a.document={elementFromPoint:()=>hit};
assert.deepEqual(a.syncPlayerUI(),{visible:false,source:'animeon-controls'});
assert.equal(a.readCursor({x:1000,y:300}).css,'none','last device pixel follows hidden controls');
opacity='1';assert.equal(a.syncPlayerUI().visible,true);
assert.equal(a.readCursor({x:1000,y:300}).css,'pointer','visible controls restore cursor');
opacity='0';hit={localName:'div'};
assert.equal(a.readCursor({x:1000,y:300}).css,'pointer','unrelated overlays do not hide cursor');
assert.equal(a.readCursor({x:1001,y:300}).inside,false);
console.log('PASS AnimeOn fade state, PiP visibility, right boundary and unrelated surfaces');

// Cursor state is independent of the player's controls state.
const attrs=new Map();
const controls={getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),toggleAttribute:(k,on)=>on?attrs.set(k,''):attrs.delete(k)};
video.openOrClosedShadowRoot={querySelector:()=>controls};
a.document.documentElement={toggleAttribute(){}};
for(const playerVisible of [false,true]){
 opacity=playerVisible?'1':'0';a.syncPlayerUI();
 const oldState=attrs.get('data-ultimate-player-ui');
 for(const idle of [true,false]){
  a.setIdle(idle);
  assert.equal(attrs.get('data-ultimate-player-ui'),oldState,'cursor changes must preserve player UI state');
  assert.equal(attrs.has('data-ultimate-cursor-hidden'),idle);
  a.syncPlayerUI();
  assert.equal(attrs.has('data-ultimate-cursor-hidden'),idle,'UI polling must preserve cursor hide state');
 }
}
a.setIdle(true);a.stopPresentation();
assert.equal(attrs.has('data-ultimate-cursor-hidden'),false,'teardown removes cursor hide marker');
console.log('PASS independent player/cursor hide reasons and teardown');

// A stale reference and a replacement UA widget must not lose cursor state.
a.presentationVideo={get:()=>({isConnected:false})};
a.trackedVideo={get:()=>video};opacity='1';a.syncPlayerUI();
assert.equal(attrs.get('data-ultimate-player-ui'),'visible');
a.setIdle(true);
const replacementAttrs=new Map();
const replacement={getAttribute:k=>replacementAttrs.get(k),setAttribute:(k,v)=>replacementAttrs.set(k,v),removeAttribute:k=>replacementAttrs.delete(k),toggleAttribute:(k,on)=>on?replacementAttrs.set(k,''):replacementAttrs.delete(k)};
video.openOrClosedShadowRoot={querySelector:()=>replacement};
// No new idle edge: the existing policy poll resynchronizes the new widget.
a.receiveMessage({name:'CursorPolicy',data:{x:999,y:300,cursorHidden:true}});
assert.equal(replacementAttrs.has('data-ultimate-cursor-hidden'),true);
assert.equal(attrs.has('data-ultimate-cursor-hidden'),false,'old widget is released');
replacementAttrs.set('data-ultimate-player-ui','hidden');
a.receiveMessage({name:'CursorPolicy',data:{x:999,y:300,cursorHidden:false}});
assert.equal(replacementAttrs.has('data-ultimate-cursor-hidden'),false);
assert.equal(replacementAttrs.get('data-ultimate-player-ui'),'hidden','showing cursor never cancels player hide reason');
opacity='0';a.syncPlayerUI();
assert.equal(replacementAttrs.get('data-ultimate-player-ui'),'hidden');
a.stopPresentation();
assert.equal(replacementAttrs.has('data-ultimate-cursor-hidden'),false);
console.log('PASS detached video fallback and replacement widget reconciliation without a cursor-state edge');

// Native button visibility must obey OR semantics without forcing a native
// hidden/policy-hidden button back on when our reasons are cleared.
function nativeButton(value='',priority=''){
 let display=value,rank=priority,writes=0;
 return {hidden:true,policy:'hidden',style:{getPropertyValue:()=>display,getPropertyPriority:()=>rank,setProperty:(k,v,p='')=>{display=v;rank=p;writes++},removeProperty:()=>{display='';rank='';writes++}},get writes(){return writes}};
}
let actualToggle=nativeButton('inline-flex');replacement.querySelector=()=>actualToggle;
a.idle=false;replacementAttrs.set('data-ultimate-player-ui','hidden');a.syncPipVisibility();
assert.equal(actualToggle.style.getPropertyValue('display'),'none');
const writes=actualToggle.writes;a.syncPipVisibility();assert.equal(actualToggle.writes,writes,'steady hidden state does not rewrite styles');
a.idle=true;replacementAttrs.set('data-ultimate-player-ui','visible');a.syncPipVisibility();
assert.equal(actualToggle.style.getPropertyValue('display'),'none','cursor hide survives visible controls');
a.idle=false;a.syncPipVisibility();
assert.equal(actualToggle.style.getPropertyValue('display'),'inline-flex','original inline display is restored');
assert.equal(actualToggle.hidden,true);assert.equal(actualToggle.policy,'hidden','native policy is untouched');
a.idle=true;a.syncPipVisibility();const oldToggle=actualToggle;actualToggle=nativeButton();a.syncPipVisibility();
assert.equal(oldToggle.style.getPropertyValue('display'),'inline-flex');
assert.equal(actualToggle.style.getPropertyValue('display'),'none','replacement native button is hidden immediately');
a.idle=false;a.syncPipVisibility();assert.equal(actualToggle.style.getPropertyValue('display'),'');
actualToggle=nativeButton('none');a.idle=true;a.syncPipVisibility();a.idle=false;a.syncPipVisibility();
assert.equal(actualToggle.style.getPropertyValue('display'),'none','pre-existing native hiding survives release');
actualToggle=nativeButton();a.idle=true;a.syncPipVisibility();actualToggle.style.setProperty('display','block','important');a.idle=false;a.syncPipVisibility();
assert.equal(actualToggle.style.getPropertyValue('display'),'block','later native style changes are not overwritten on release');
console.log('PASS direct native PiP hiding: independent reasons, idempotence, replacement, native restrictions and restoration');
