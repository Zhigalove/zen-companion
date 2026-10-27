// User-scoped settings bridge. No network, page data or executable commands.
let timer,stamp=-1,working=false,onApproved,started=false;
const bridgeVersion = '0.1.1';
const path=Services.dirsvc.get('ProfD',Ci.nsIFile).path+'/ultimate-glass-settings.json';
const uiPreferences={"ui.textSelectAttentionBackground": "#3873c5", "ui.textSelectAttentionForeground": "#ffffff", "ui.textHighlightBackground": "#d9e8ff", "ui.textHighlightForeground": "#1b2b42", "ui.textSelectAttentionBackground.dark": "#90baff", "ui.textSelectAttentionForeground.dark": "#14243c", "ui.textHighlightBackground.dark": "#304c70", "ui.textHighlightForeground.dark": "#f2f6fc", "ui.-moz-autofill-background": "#edf3fc", "ui.-moz-autofill-background.dark": "#283b52"};
function apply(enabled,transparency){
 for(const [key,value] of Object.entries(uiPreferences)){if(enabled)Services.prefs.setStringPref(key,value);else Services.prefs.clearUserPref(key);}
 Services.prefs.setBoolPref('mod.zenliquid.app-disabled',!enabled);
 Services.prefs.setBoolPref('mod.zenliquid.video-companion.enabled',enabled);
 Services.prefs.setStringPref('mod.zenliquid.transparency',transparency+'%');
 for(const w of Services.wm.getEnumerator('navigator:browser')){
  w.document.documentElement.style.setProperty('--lg-transparency',transparency+'%');
  const holder=w.document.getElementById('theme-Ultimate-Liquid-Glass');
  holder?.setAttribute('mod-zenliquid-transparency',transparency+'%');
 }
}
export async function readSettings(){
 if(working)return;working=true;
 try{
  const stat=await IOUtils.stat(path);if(stat.lastModified===stamp)return;
  const s=await IOUtils.readJSON(path);
  if(s.schema!==1||typeof s.enabled!=='boolean'||!Number.isInteger(s.transparency)||s.transparency<0||s.transparency>100)throw Error('Invalid settings');
  const approved=s.testedZen?.some(z=>z.version===Services.appinfo.version&&z.buildID===Services.appinfo.appBuildID);
  apply(s.enabled&&!!approved,s.transparency);stamp=stat.lastModified;
  if(approved&&onApproved&&!started){started=true;try{onApproved()}catch(e){started=false;throw e}}
  await IOUtils.writeJSON(path+'.applied.json',{schema:1,bridgeVersion,companionStarted:started,revision:s.revision,enabled:s.enabled&&!!approved,transparency:s.transparency,compatible:!!approved,appliedAt:Date.now()});
 }catch(e){
  apply(false,40);console.error('[Ultimate Glass settings]',e);
 }finally{working=false;}
}
export function startSettingsBridge(callback){
 if(callback)onApproved=callback;
 if(timer)return;
 timer=Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
 timer.initWithCallback(()=>readSettings(),750,Ci.nsITimer.TYPE_REPEATING_SLACK);
 Services.obs.addObserver(()=>{timer?.cancel();timer=null;},'quit-application-granted');
 readSettings();
}
