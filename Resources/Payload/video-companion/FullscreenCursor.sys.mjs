// Mirror the page's effective CSS cursor; never invent a player inactivity timer.
import {nativeCursor,pointerLocation,applicationIsActive,nativeCursorStatus} from 'resource://ultimate-glass-video/NativeCursor.sys.mjs';
const controllers=new WeakMap(),PREF='mod.zenliquid.video-companion.enabled';
export function fullscreenCursorFor(w){
 if(controllers.has(w))return controllers.get(w);
 const root=w.document.documentElement,media=new Map();
 let hidden=false,watch=0,inFlight=false,epoch=0,closed=false,lastPolicy=null,lastPoint=null,context=false;
 let windowActive=Services.focus.activeWindow===w;
 const foreground=()=>windowActive&&!w.windowUtils.isWindowFullyOccluded&&(Services.focus.activeWindow===w||(!Services.focus.activeWindow&&applicationIsActive()&&Services.wm.getMostRecentWindow('navigator:browser')===w));
 const enabled=()=>Services.prefs.getBoolPref(PREF,true);
 function frames(){return w.gBrowser.selectedBrowser.browsingContext.getAllBrowsingContextsInSubtree();}
 function eachFrame(fn){for(const bc of frames())try{const g=bc.currentWindowGlobal;if(g)fn(g.getActor('UltimateGlassVideo'));}catch{}}
 function prune(){for(const [g] of media)try{if(g.isClosed||g.browsingContext.top.embedderElement!==w.gBrowser.selectedBrowser)media.delete(g);}catch{media.delete(g);}}
 const records=[],until=Date.now()+15*60*1000;let logTimer=0;
 const path=Services.dirsvc.get('ProfD',Ci.nsIFile).path+'/ultimate-cursor-diagnostics.json';
 function record(reason){
  if(closed||Date.now()>until)return;
  records.push({time:Date.now(),reason,hidden,foreground:foreground(),mediaFrames:media.size,css:lastPolicy?.css||null,native:nativeCursorStatus()});if(records.length>32)records.shift();
  if(!logTimer)logTimer=w.setTimeout(()=>{logTimer=0;IOUtils.writeJSON(path,{version:'2.3.51',controller:'css-cursor-sync',records:[...records]}).catch(e=>console.error('[Ultimate Glass cursor]',e));},500);
 }
 function setHidden(value){
  if(value){if(!nativeCursor(w,true))return;}else nativeCursor(w,false);
  if(value===hidden)return;hidden=value;
  eachFrame(a=>a.sendAsyncMessage('CursorIdle',{idle:value}));record(value?'hide-css-none':'show-css-visible');
 }
 function insideContent(p){
  const r=w.gBrowser.selectedBrowser.getBoundingClientRect(),x=w.mozInnerScreenX+r.x,y=w.mozInnerScreenY+r.y;
  // Chrome's transformed browser box can end between device pixels (e.g.
  // 1679.900), while the child viewport still ends at 1680. Quartz reports
  // subpixel hotspots there. Cover the touched device pixel; the actor then
  // checks the actual viewport and CSS. Never extend outside this window.
  const scale=w.devicePixelRatio||1;
  const left=Math.floor(x*scale)/scale,top=Math.floor(y*scale)/scale;
  const right=Math.ceil((x+r.width)*scale)/scale,bottom=Math.ceil((y+r.height)*scale)/scale;
  if(!(p.x>=Math.max(left,w.screenX)&&p.x<=Math.min(right,w.screenX+w.outerWidth)&&
   p.y>=Math.max(top,w.screenY)&&p.y<=Math.min(bottom,w.screenY+w.outerHeight)))return false;
  // Hit-test browser chrome first: a floating sidebar can cover the page while
  // the video's CSS below it still says cursor:none. Sample just inside the
  // visual box at fractional edges, preserving the device-pixel boundary fix.
  const inset=Math.min(.5/scale,r.width/2,r.height/2);
  const cx=Math.min(Math.max(p.x-w.mozInnerScreenX,r.left+inset),r.right-inset);
  const cy=Math.min(Math.max(p.y-w.mozInnerScreenY,r.top+inset),r.bottom-inset);
  let hit=w.document.elementFromPoint(cx,cy);
  while(hit){
   if(hit===w.gBrowser.selectedBrowser)return true;
   hit=hit.parentElement||hit.getRootNode()?.host;
  }
  return false;
 }
 async function poll(){
  if(closed)return;
  if(!enabled()||!media.size||!foreground()){epoch++;setHidden(false);return;}
  const point=pointerLocation();
  if(!point||!insideContent(point)){epoch++;setHidden(false);lastPoint=point;return;}
  if(lastPoint&&(point.x!==lastPoint.x||point.y!==lastPoint.y)){epoch++;setHidden(false);}
  lastPoint=point;
  if(inFlight)return;
  inFlight=true;const stamp=epoch,browser=w.gBrowser.selectedBrowser;
  try{
   const contexts=frames();let bc=browser.browsingContext,policy=null;
   for(let depth=0;depth<16&&bc?.currentWindowGlobal;depth++){
    policy=await bc.currentWindowGlobal.getActor('UltimateGlassVideo').sendQuery('CursorPolicy',point);
    if(!policy?.inside)break;
    if(!policy.child)break;
    bc=contexts.find(c=>c.id===policy.child);
    if(!bc){policy=null;break;}
   }
   const current=pointerLocation();
   if(closed||stamp!==epoch||browser!==w.gBrowser.selectedBrowser||!foreground()||!enabled()||!current||current.x!==point.x||current.y!==point.y)return;
   lastPolicy=policy;setHidden(insideContent(current)&&!!policy?.inside&&policy.css==='none');
  }catch(e){lastPolicy={css:'unavailable'};setHidden(false);}
  finally{inFlight=false;}
 }
 function sync(){
  prune();
  const active=enabled()&&media.size>0;
  if(active&&!watch)watch=w.setInterval(()=>{poll();},80);
  if(!active){if(watch)w.clearInterval(watch);watch=0;epoch++;setHidden(false);}
  const next=enabled()&&(root.hasAttribute('inDOMFullscreen')||!!w.document.fullscreenElement||[...media.values()].some(d=>d.pageSized));
  if(next!==context){context=next;eachFrame(a=>a.sendAsyncMessage('FullscreenContext',{active:context}));}
  poll();
 }
 function input(){epoch++;setHidden(false);poll();}
 function focus(e){windowActive=e.type==='activate';epoch++;setHidden(false);if(windowActive)poll();}
 const observer=new w.MutationObserver(sync);observer.observe(root,{attributes:true,attributeFilter:['inDOMFullscreen']});
 for(const n of ['mousemove','pointerdown','keydown'])w.addEventListener(n,input,true);
 for(const n of ['activate','deactivate'])w.addEventListener(n,focus,true);
 w.addEventListener('fullscreenchange',sync,true);
 const probe=()=>{media.clear();epoch++;setHidden(false);sync();eachFrame(a=>a.sendAsyncMessage('WatchPresentation'));};
 w.gBrowser.tabContainer.addEventListener('TabSelect',probe);
 Services.prefs.addObserver(PREF,probe);
 const controller={presentation(global,data){
   if(data.video)media.set(global,data);else media.delete(global);sync();
  },activity:input,state(global){if(context)try{global.getActor('UltimateGlassVideo').sendAsyncMessage('CursorIdle',{idle:hidden});}catch{}},
  status:()=>({controller:'css-cursor-sync',independentIdleTimer:false,mediaFrames:media.size,idle:hidden,lastPolicy,foreground:foreground(),parentFullscreen:context,native:nativeCursorStatus()})};
 controllers.set(w,controller);
 w.addEventListener('unload',()=>{closed=true;epoch++;if(watch)w.clearInterval(watch);if(logTimer)w.clearTimeout(logTimer);setHidden(false);observer.disconnect();Services.prefs.removeObserver(PREF,probe);for(const n of ['mousemove','pointerdown','keydown'])w.removeEventListener(n,input,true);for(const n of ['activate','deactivate'])w.removeEventListener(n,focus,true);w.removeEventListener('fullscreenchange',sync,true);w.gBrowser.tabContainer.removeEventListener('TabSelect',probe);},{once:true});
 record('loaded');probe();return controller;
}
