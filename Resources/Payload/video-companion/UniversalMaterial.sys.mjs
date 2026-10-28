// Pixel-source adapter for measured frosted material. No network, disk or DOM
// capture. Low resolution snapshots never leave the chrome document's memory.
let timer=null,active=false,generation=0;
const states=new WeakMap();
const diagnostics={captures:0,errors:0,lastMs:0};
function clear(w){
 for(const n of w.document.querySelectorAll('[data-lg-material]')){
  n.removeAttribute('data-lg-material');n.style.removeProperty('--lg-live-backdrop');
 }
 for(const n of w.document.querySelectorAll('[data-lg-ink]')){
  n.removeAttribute('data-lg-ink');n.style.removeProperty('--lg-local-ink');
 }
}
function visible(w,n){
 if(!n||n.hidden)return false;
 const r=n.getBoundingClientRect(),s=w.getComputedStyle(n);
 return r.width>40&&r.height>20&&Math.min(r.right,w.innerWidth)-Math.max(r.left,0)>40&&r.bottom>0&&r.top<w.innerHeight&&s.visibility==='visible'&&s.display!=='none';
}
function ink(w,surface,ctx,width,height){
 const sr=surface.getBoundingClientRect();
 const candidates=new Set(surface.querySelectorAll('label,.tab-label,.toolbarbutton-text,.toolbarbutton-icon,.tab-group-label,#urlbar-input,.urlbarView-title,.urlbarView-action,.urlbarView-url,.urlbarView-title-separator,.zen-media-title,.zen-media-artist,button,input,span'));
 for(const n of surface.querySelectorAll('*')){if([...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim()))candidates.add(n);}
 for(const n of candidates){
  const r=n.getBoundingClientRect();if(r.width<1||r.height<1)continue;
  const x=Math.max(0,Math.min(width-1,Math.floor((r.left-sr.left)/sr.width*width)));
  const y=Math.max(0,Math.min(height-1,Math.floor((r.top-sr.top)/sr.height*height)));
  const rw=Math.max(1,Math.min(width-x,Math.ceil(r.width/sr.width*width))),rh=Math.max(1,Math.min(height-y,Math.ceil(r.height/sr.height*height)));
  const pixels=ctx.getImageData(x,y,rw,rh).data;let luma=0;
  for(let i=0;i<pixels.length;i+=4)luma+=(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255;
  luma/=pixels.length/4;
  const alpha=Math.max(.04,1-parseFloat(Services.prefs.getStringPref('mod.zenliquid.transparency','40%'))/100);
  luma=(.134+luma*.58022)*(1-alpha)+.50196*alpha;
  // Hysteresis prevents video/noise from making labels chatter around a split.
  const old=n.getAttribute('data-lg-ink'),dark=luma>(old==='dark'?.44:.48);
  n.setAttribute('data-lg-ink',dark?'dark':'light');
  n.style.setProperty('--lg-local-ink',dark?'#202124':'#f5f5f7');
 }
}
export async function updateWindow(w){
 if(!active||w.closed||w.document.hidden||w.windowUtils?.isWindowFullyOccluded||Services.focus.activeWindow!==w)return;
 let state=states.get(w);if(!state){
  state={busy:false,next:0,errors:0};
  state.invalidate=()=>{if(active){clear(w);state.next=0;}};
  w.gBrowser?.tabContainer?.addEventListener('TabSelect',state.invalidate);
  w.addEventListener?.('resize',state.invalidate);
  states.set(w,state);
 }
 if(state.busy||Date.now()<state.next)return;
 if(state.errors>=3)state.errors=0;
 const d=w.document,b=w.gBrowser?.selectedBrowser;if(!b)return;
 const nav=d.getElementById('titlebar'),search=d.querySelector('#urlbar:is([open],[breakout-extend="true"]) .urlbar-background'),library=d.querySelector('zen-library');
 // Avoid capturing search twice when it is still geometrically in navigation.
 const surfaces=[nav,search,library].filter(n=>visible(w,n));if(!surfaces.length)return;
 state.busy=true;const epoch=generation,start=Date.now();
 try{
  for(const surface of surfaces){
   if(!active||epoch!==generation||w.closed)break;
   const r=surface.getBoundingClientRect(),br=b.getBoundingClientRect();
   if(br.width<1||br.height<1)continue;
   const sw=Math.min(r.width,br.width),sh=Math.min(r.height,br.height);
   const rect=new w.DOMRect(Math.max(0,Math.min(br.width-sw,r.left-br.left)),Math.max(0,Math.min(br.height-sh,r.top-br.top)),sw,sh);
   const global=b.browsingContext?.currentWindowGlobal;if(!global?.drawSnapshot)continue;
   const scale=Math.min(.125,64/sw,180/sh);
   const bitmap=await global.drawSnapshot(rect,scale,'white');
   try{
    if(!active||epoch!==generation||w.closed||Services.focus.activeWindow!==w||b!==w.gBrowser.selectedBrowser)break;
    const canvas=d.createElementNS('http://www.w3.org/1999/xhtml','canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
    surface.style.setProperty('--lg-live-backdrop',`url("${canvas.toDataURL()}")`);
    surface.setAttribute('data-lg-material','ready');
    ink(w,surface,ctx,canvas.width,canvas.height);
    diagnostics.captures++;state.errors=0;
   }finally{bitmap.close();}
  }
 }catch(e){state.errors++;diagnostics.errors++;}
 finally{
  diagnostics.lastMs=Date.now()-start;
  state.next=Date.now()+Math.max(state.errors>=3?15000:750,diagnostics.lastMs*5);state.busy=false;
 }
}
export function setUniversalMaterial(enabled){
 if(active===enabled)return;
 active=enabled;generation++;
 if(!enabled){timer?.cancel();timer=null;for(const w of Services.wm.getEnumerator('navigator:browser')){
  clear(w);const s=states.get(w);if(s)s.next=0; // Retain the busy gate across rapid off/on toggles.
 }return;}
 timer=Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
 timer.initWithCallback(()=>{for(const w of Services.wm.getEnumerator('navigator:browser'))void updateWindow(w);},750,Ci.nsITimer.TYPE_REPEATING_SLACK);
}
export function materialStatus(){return {active,...diagnostics};}
Services.obs.addObserver(()=>setUniversalMaterial(false),'quit-application-granted');
