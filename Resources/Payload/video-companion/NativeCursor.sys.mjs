// Quartz owns one balanced hide/show pair, independent of AppKit cursor regions.
let bridge=null,owner=null,error=null,hideCalls=0,showCalls=0;
function initialize(){
 if(bridge||error||Services.appinfo.OS!=='Darwin')return;
 try{
  const {ctypes:c}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
  const cg=c.open('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf=c.open('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const point=c.StructType('CGPoint',[{x:c.double},{y:c.double}]);
  const create=cg.declare('CGEventCreate',c.default_abi,c.voidptr_t,c.voidptr_t);
  const locate=cg.declare('CGEventGetLocation',c.default_abi,point,c.voidptr_t);
  const release=cf.declare('CFRelease',c.default_abi,c.void_t,c.voidptr_t);
  const hide=cg.declare('CGDisplayHideCursor',c.default_abi,c.int32_t,c.uint32_t);
  const show=cg.declare('CGDisplayShowCursor',c.default_abi,c.int32_t,c.uint32_t);
  const button=cg.declare('CGEventSourceButtonState',c.default_abi,c.bool,c.int32_t,c.uint32_t);
  const objc=c.open('/usr/lib/libobjc.A.dylib');
  const getClass=objc.declare('objc_getClass',c.default_abi,c.voidptr_t,c.char.ptr);
  const selector=objc.declare('sel_registerName',c.default_abi,c.voidptr_t,c.char.ptr);
  const object=objc.declare('objc_msgSend',c.default_abi,c.voidptr_t,c.voidptr_t,c.voidptr_t);
  const boolean=objc.declare('objc_msgSend',c.default_abi,c.bool,c.voidptr_t,c.voidptr_t);
  bridge={c,cg,cf,objc,create,locate,release,hide,show,button,object,boolean,app:getClass('NSApplication'),shared:selector('sharedApplication'),active:selector('isActive')};
 }catch(e){error=String(e);console.error('[Ultimate Glass Quartz]',e);}
}
export function pointerLocation(){
 initialize();if(!bridge)return null;
 const event=bridge.create(bridge.c.voidptr_t(0));if(event.isNull())return null;
 try{const p=bridge.locate(event);return {x:p.x,y:p.y};}finally{bridge.release(event);}
}
export function applicationIsActive(){
 initialize();if(!bridge)return false;
 const app=bridge.object(bridge.app,bridge.shared);
 return !app.isNull()&&bridge.boolean(app,bridge.active);
}
export function primaryMouseDown(){initialize();return bridge?bridge.button(0,0):false;}
function showOwned(){
 if(!owner)return true;
 const code=bridge.show(0);
 if(code!==0){error='CGDisplayShowCursor: '+code;return false;}
 owner=null;showCalls++;return true;
}
export function nativeCursor(w,hidden){
 initialize();if(!bridge)return false;
 if(!hidden)return owner===w?showOwned():true;
 if((Services.focus.activeWindow!==w&&!applicationIsActive())||w.windowUtils.isWindowFullyOccluded)return false;
 if(owner===w)return true;
 if(!showOwned())return false;
 const code=bridge.hide(0);
 if(code!==0){error='CGDisplayHideCursor: '+code;return false;}
 owner=w;hideCalls++;return true;
}
export function nativeCursorStatus(){initialize();return {backend:'Quartz',ready:!!bridge,error,hideCalls,showCalls,owned:!!owner};}
Services.obs.addObserver(()=>{if(bridge)showOwned();},'quit-application-granted');
