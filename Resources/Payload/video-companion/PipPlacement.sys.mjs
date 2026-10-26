import {primaryMouseDown} from 'resource://ultimate-glass-video/NativeCursor.sys.mjs';
const manager=Cc['@mozilla.org/gfx/screenmanager;1'].getService(Ci.nsIScreenManager);
const attached=new WeakSet();let started=false;
export function constrainRect(rect,area,gap=8){
 const scale=Math.min(1,(area.width-2*gap)/rect.width,(area.height-gap)/rect.height);
 const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
 return {x:Math.round(Math.max(area.x+gap,Math.min(rect.x,area.x+area.width-gap-width))),
 y:Math.round(Math.max(area.y,Math.min(rect.y,area.y+area.height-gap-height))),width,height};
}
function rect(w){return {x:w.screenX,y:w.screenY,width:w.outerWidth,height:w.outerHeight};}
function key(r){return [r.x,r.y,r.width,r.height].join(',');}
function destination(w,r=rect(w),dx=0,dy=0){
 const screen=manager.screenForRect(r.x,r.y,r.width,r.height);
 const x={},y={},width={},height={};screen.GetAvailRectDisplayPix(x,y,width,height);
 return constrainRect({...r,x:r.x+dx,y:r.y+dy},{x:x.value,y:y.value,width:width.value,height:height.value});
}
export function fitPip(w){
 if(w.closed||w.fullScreen||!Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true))return;
 const r=rect(w),result=destination(w,r);
 if(result.width!==r.width||result.height!==r.height)w.resizeTo(result.width,result.height);
 if(result.x!==r.x||result.y!==r.y)w.moveTo(result.x,result.y);
 return result;
}
export function glidePosition(start,target,progress){
 const t=Math.max(0,Math.min(1,progress));return start+(target-start)*(1-Math.pow(1-t,3));
}
export function attachPip(w){
 if(attached.has(w)||w.document.documentElement.getAttribute('windowtype')!=='Toolkit:PictureInPicture')return;
 attached.add(w);let last='',dirty=true,frame=0;
 const enabled=()=>!w.closed&&!w.fullScreen&&Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true);
 const reduced=()=>w.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const stop=()=>{if(frame)w.cancelAnimationFrame(frame);frame=0;};
 function animate(){
  stop();if(!enabled())return;
  const r=rect(w),target=destination(w,r);
  if(target.width!==r.width||target.height!==r.height)w.resizeTo(target.width,target.height);
  if(reduced()){w.moveTo(target.x,target.y);last=key(rect(w));return;}
  const start=w.performance.now(),duration=260;
  const step=now=>{
   frame=0;if(!enabled())return;
   if(primaryMouseDown()){dirty=true;return;}
   const progress=(now-start)/duration;
   w.moveTo(Math.round(glidePosition(r.x,target.x,progress)),Math.round(glidePosition(r.y,target.y,progress)));last=key(rect(w));
   if(progress>=1){w.moveTo(target.x,target.y);last=key(rect(w));return;}
   frame=w.requestAnimationFrame(step);
  };
  if(Math.abs(target.x-r.x)+Math.abs(target.y-r.y)<1){last=key(r);return;}
  frame=w.requestAnimationFrame(step);
 }
 const tick=()=>{
  if(!enabled()||frame)return;
  const current=key(rect(w));if(current!==last){last=current;dirty=true;}
  if(!dirty)return;
  if(primaryMouseDown()){dirty=true;return;}
  dirty=false;animate();
 };
 const down=e=>{if(e.button===0&&enabled()){stop();dirty=true;}};
 w.addEventListener('mousedown',down,true);
 const timer=w.setInterval(tick,200);
 w.addEventListener('unload',()=>{stop();w.clearInterval(timer);w.removeEventListener('mousedown',down,true);},{once:true});
 tick();
}
export function startPipPlacement(){
 if(started)return;started=true;
 Services.obs.addObserver(w=>{
  if(w.document.documentElement?.getAttribute('windowtype')==='Toolkit:PictureInPicture')attachPip(w);
  else w.addEventListener('load',()=>attachPip(w),{once:true});
 },'domwindowopened');
 for(const w of Services.wm.getEnumerator('Toolkit:PictureInPicture'))attachPip(w);
}
