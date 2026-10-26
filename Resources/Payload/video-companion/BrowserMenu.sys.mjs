// Chrome-style context action, using Firefox's local full-page translation engine.
import {TranslationsParent} from 'resource://gre/actors/TranslationsParent.sys.mjs';
// Prefer the actual text identification when HTML claims the target language.
// Patch the public actor boundary so the native panel and context action agree.
const originalGetLangTags=TranslationsParent.prototype.getLangTags;
TranslationsParent.prototype.getLangTags=async function(...args){
 const tags=await originalGetLangTags.apply(this,args);
 if(!tags||!Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true))return tags;
 const target=await TranslationsParent.getTopPreferredSupportedToLang();
 const base=tag=>tag?.split('-')[0];
 let source=tags.docLangTag;
 if(base(source)===base(target)&&tags.identified?.language&&
    base(tags.identified.language)!==base(target)&&tags.identified.languages?.some(
     row=>base(row.languageCode)===base(tags.identified.language)&&row.percent>=50)){
  const pairs=await TranslationsParent.getNonPivotLanguagePairs();
  source=TranslationsParent.findCompatibleSourceLangTagSync(tags.identified.language,pairs)||source;
 }
 if(base(source)===base(target))return tags;
 const corrected={...tags,docLangTag:source,isDocLangTagSupported:source!==tags.docLangTag||tags.isDocLangTagSupported,userLangTag:target};
 if(this.languageState?.detectedLanguages===tags)this.languageState.detectedLanguages=corrected;
 return corrected;
};
export function attachPageMenu(w){
 const d=w.document,menu=d.getElementById('contentAreaContextMenu');
 if(!menu||d.getElementById('ultimate-context-translate-page'))return;
 const item=d.createXULElement('menuitem');
 item.id='ultimate-context-translate-page';item.hidden=true;
 const selection=d.getElementById('context-translate-selection');
 menu.insertBefore(item,selection?.nextSibling||d.getElementById('context-viewsource'));
 let pending=false,target='ru',revision=0;
 const label=()=>{
  const name=new Intl.DisplayNames(['ru'],{type:'language'}).of(target);
  item.setAttribute('label',`Перевести на ${name.toLocaleLowerCase('ru')}`);
 };
 const update=event=>{
  if(event.target!==menu)return;
  const ctx=w.gContextMenu,browser=w.gBrowser.selectedBrowser,rev=++revision;
  const type=browser.documentContentType;
  item.hidden=!Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true)||!ctx||!/^(https?|file):/.test(browser.currentURI.spec)||
   (type&&type!=='text/html'&&type!=='application/xhtml+xml')||ctx.onTextInput||ctx.onVideo||ctx.onAudio;
  item.disabled=pending||!Services.prefs.getBoolPref('browser.translations.enable',true);
  if(item.hidden)return;
  target=Services.prefs.getStringPref('browser.translations.mostRecentTargetLanguages','').split(',')[0]||Services.locale.appLocaleAsBCP47.split('-')[0];
  const translated=!!TranslationsParent.getTranslationsActor(browser)?.languageState.requestedLanguagePair;
  if(translated){item.setAttribute('label','Показать оригинал');return;}
  label();
  TranslationsParent.getTopPreferredSupportedToLang().then(lang=>{
   if(w.closed||revision!==rev||w.gBrowser.selectedBrowser!==browser)return;
   target=lang;label();
  }).catch(e=>console.error('[Ultimate Glass translate]',e));
 };
 item.addEventListener('command',event=>{
  if(pending)return;
  const browser=w.gBrowser.selectedBrowser,inner=browser.browsingContext.currentWindowGlobal?.innerWindowId,to=target;
  const valid=()=>!w.closed&&w.gBrowser.selectedBrowser===browser&&browser.browsingContext.currentWindowGlobal?.innerWindowId===inner;
  const run=async()=>{
   if(!valid())return;
   pending=true;
   try{
    const actor=TranslationsParent.getTranslationsActor(browser);
    if(actor.languageState.requestedLanguagePair){actor.restorePage();return;}
    {
     const tags=await actor.getLangTags();
     if(!valid())return;
     if(tags?.isDocLangTagSupported&&tags.docLangTag&&tags.docLangTag.split('-')[0]!==to.split('-')[0]){
      // The context action translates silently; the URL bar icon retains settings.
      await actor.translate({sourceLanguage:tags.docLangTag,targetLanguage:to},false);
      return;
     }
    }
    if(valid())await w.FullPageTranslationsPanel.open(event);
   }catch(e){console.error('[Ultimate Glass translate]',e);if(valid())w.FullPageTranslationsPanel.open(event);}
   finally{pending=false;}
  };
  const open=()=>w.setTimeout(run,0);
  if(['open','showing','hiding'].includes(menu.state)){
   const hidden=e=>{if(e.target!==menu)return;menu.removeEventListener('popuphidden',hidden);open();};
   menu.addEventListener('popuphidden',hidden);menu.hidePopup();
  }else open();
 });
 menu.addEventListener('popupshowing',update);
 w.addEventListener('unload',()=>{revision++;menu.removeEventListener('popupshowing',update);item.remove();},{once:true});
}
