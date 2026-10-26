import {fullscreenCursorFor as cursorFor} from 'resource://ultimate-glass-video/FullscreenCursor.sys.mjs';
import {startPipPlacement} from 'resource://ultimate-glass-video/PipPlacement.sys.mjs';
import {attachPageMenu} from 'resource://ultimate-glass-video/BrowserMenu.sys.mjs';
import {applicationIsActive} from 'resource://ultimate-glass-video/NativeCursor.sys.mjs';
const { PictureInPicture } = ChromeUtils.importESModule('moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs');
const ENABLED = 'mod.zenliquid.video-companion.enabled';
const controllers = new WeakMap();
let launchInFlight = false;
// Bind an automatic request to the exact native window after synchronous
// player setup has run, without waiting on first-use content initialization. No timeout or focus event can make that provenance disappear.
const automaticRequests=new WeakMap(),requestData=new WeakMap();
const ownershipTrace={requests:0,matched:0,opens:0,registered:0};
const nativeOpen=PictureInPicture.openPipWindow,nativeRequest=PictureInPicture.handlePictureInPictureRequest;
PictureInPicture.openPipWindow=async function(parent,data){
 ownershipTrace.opens++;
 const player=await nativeOpen.call(this,parent,data);
 const request=requestData.get(data);
 if(request){
  const setup=player.setupPlayer;
  player.setupPlayer=function(...args){
   const result=setup.apply(this,args);player.setupPlayer=setup;
   Promise.resolve().then(()=>{if(!player.closed)request.register(player);});
   return result;
  };
 }
 return player;
};
PictureInPicture.handlePictureInPictureRequest=async function(global,data){
 ownershipTrace.requests++;
 const browser=global.browsingContext.top.embedderElement,request=automaticRequests.get(browser);
 if(request){ownershipTrace.matched++;automaticRequests.delete(browser);requestData.set(data,request);}
 try{return await nativeRequest.call(this,global,data);}
 finally{requestData.delete(data);}
};
export function attach(w) {
  if (controllers.has(w)) return controllers.get(w);
  const own = new Map(), sourceFrames = new WeakMap(), suppressed = new WeakSet(), closing = new WeakSet(), awaiting = new Map();
  let nextAttempt = 0;
  let stopped = false, pending = false, generation = 0;
  const enabled = () => Services.prefs.getBoolPref(ENABLED, true);
  const players = () => [...Services.wm.getEnumerator('Toolkit:PictureInPicture')];
  const hidden = () => w.windowUtils.isWindowFullyOccluded || !(Services.focus.activeWindow===w || w.document.hasFocus() || (applicationIsActive() && Services.wm.getMostRecentWindow('navigator:browser')===w));
  const selected = () => w.gBrowser.selectedBrowser;
  const wait = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  let lastSelected = selected();
  function restore(forceActive=false) {
    for(const [browser,request] of awaiting)if(Date.now()>request.until){
      awaiting.delete(browser);
      if(automaticRequests.get(browser)===request)automaticRequests.delete(browser);
    }
    for (const [browser,player] of own) {
      if (player.closed) { own.delete(browser); suppressed.add(browser); continue; }
      if ((forceActive || !hidden()) && selected() === browser && !closing.has(player)) {
        closing.add(player);
        // Restore the video image now, without waiting for macOS window teardown.
        try { sourceFrames.get(browser)?.getActor('UltimateGlassVideo').sendAsyncMessage('Restore'); } catch {}
        PictureInPicture.closePipWindow(player).then(()=>{if(own.get(browser)===player)own.delete(browser);}).catch(e=>console.error('[Ultimate Glass return]',e)).finally(()=>closing.delete(player));
      }
    }
  }
  let focusRetry;
  const returnNow = event => {
    restore(event?.type === 'activate' || event?.type === 'TabSelect' || event?.type === 'focus' || event?.type === 'pointerdown');
    if (focusRetry) w.clearTimeout(focusRetry);
    focusRetry = w.setTimeout(()=>restore(),0);
  };
  async function check() {
    if (stopped || !enabled()) return;
    const previous = lastSelected;
    lastSelected = selected();
    const departed = previous !== lastSelected ? previous : null;
    restore();
    if (!hidden()) { suppressed.delete(selected()); nextAttempt = 0; if (!departed) return; }
    if (pending || launchInFlight || Date.now() < nextAttempt) return;
    const browser = departed || selected();
    if (!browser || browser.audioMuted || suppressed.has(browser)) return;
    if (players().length || own.has(browser) || awaiting.has(browser)) return;
    nextAttempt = Date.now() + 5000;
    launchInFlight = true;
    pending = true;
    const stamp = ++generation;
    try {
      const candidates = [];
      for (const bc of browser.browsingContext.getAllBrowsingContextsInSubtree()) {
        try {
          const global = bc.currentWindowGlobal;
          if (global) {
            const score = await global.getActor('UltimateGlassVideo').sendQuery('Candidate');
            if (score > 0) candidates.push({global,score});
          }
        } catch {} // Internal documents and unloaded frames are ineligible.
      }
      candidates.sort((a,b)=>b.score-a.score);
      if (!candidates.length || stopped || !enabled()) return;
      if (!hidden() && selected() === browser) return;
      const request={until:Date.now()+15000,register(player){
        if(stopped)return;
        ownershipTrace.registered++;awaiting.delete(browser);own.set(browser,player);sourceFrames.set(browser,candidates[0].global);
        restore();
      }};
      awaiting.set(browser,request);automaticRequests.set(browser,request);
      candidates[0].global.getActor('PictureInPictureLauncher').sendAsyncMessage('PictureInPicture:AutoToggle');
      for (let n=0;n<500 && !stopped;n++) {
        await wait(16);
        if(!awaiting.has(browser))break;
        if (stamp !== generation) break;
      }
    } catch (e) { console.error('[Ultimate Glass Video]', e); }
    finally { pending = false; launchInFlight = false; }
  }
  const tick = () => { check().catch(e=>console.error('[Ultimate Glass Video]',e)); };
  const timer = w.setInterval(tick,750);
  for (const name of ['activate','deactivate','sizemodechange','occlusionstatechange']) w.addEventListener(name,tick);
  for(const name of ['activate','focus','pointerdown'])w.addEventListener(name,returnNow,true);
  w.gBrowser.tabContainer.addEventListener('TabSelect',returnNow,true);
  w.gBrowser.tabContainer.addEventListener('TabSelect',tick);
  const controller = {check,status:()=>({ownershipTrace:{...ownershipTrace},owned:own.size,awaiting:awaiting.size,hidden:hidden(),applicationActive:applicationIsActive(),occluded:w.windowUtils.isWindowFullyOccluded,sourceSelected:[...own.keys()].includes(selected())}),stop(){stopped=true;awaiting.clear();generation++;w.clearInterval(timer);if(focusRetry)w.clearTimeout(focusRetry);for(const name of ['activate','focus','pointerdown'])w.removeEventListener(name,returnNow,true);w.gBrowser.tabContainer.removeEventListener('TabSelect',returnNow,true);for(const name of ['activate','deactivate','sizemodechange','occlusionstatechange'])w.removeEventListener(name,tick);w.gBrowser.tabContainer.removeEventListener('TabSelect',tick);}};
  w.addEventListener('unload',()=>controller.stop(),{once:true});
  controllers.set(w,controller);
  return controller;
}
export function start() {
  ChromeUtils.importESModule('resource://ultimate-glass-video/AppSettings.sys.mjs').startSettingsBridge();
  startPipPlacement();
  Services.prefs.getDefaultBranch('').setBoolPref(ENABLED,true);
  try {
    ChromeUtils.registerWindowActor('UltimateGlassVideo', {
      parent:{esModuleURI:'resource://ultimate-glass-video/VideoParent.sys.mjs'},
      child: {esModuleURI:'resource://ultimate-glass-video/VideoChild.sys.mjs',events:{DOMContentLoaded:{capture:true},pageshow:{capture:true},visibilitychange:{capture:true,createActor:false},loadedmetadata:{capture:true},fullscreenchange:{capture:true},mousemove:{capture:true,createActor:false},pointerdown:{capture:true,createActor:false},keydown:{capture:true,createActor:false},pagehide:{capture:true,createActor:false},play:{capture:true,createActor:false},pause:{capture:true,createActor:false},ended:{capture:true,createActor:false}}},
      safeForUntrustedWebProcess:true,allFrames:true,matches:['http://*/*','https://*/*','file:///*']
    });
  } catch(e) { console.error('[Ultimate Glass Video actor]',e); }
  Services.obs.addObserver(w=>{attach(w);cursorFor(w);attachPageMenu(w);},'browser-delayed-startup-finished');
  for (const w of Services.wm.getEnumerator('navigator:browser')) if(w.gBrowserInit?.delayedStartupFinished){attach(w);cursorFor(w);attachPageMenu(w);}
}

export {fullscreenCursorFor as cursorFor} from 'resource://ultimate-glass-video/FullscreenCursor.sys.mjs';
