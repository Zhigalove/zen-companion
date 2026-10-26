import {cursorFor} from 'resource://ultimate-glass-video/VideoCompanion.sys.mjs';
export class UltimateGlassVideoParent extends JSWindowActorParent {
  receiveMessage(message) {
    const browser=this.browsingContext.top.embedderElement,w=browser?.documentGlobal||browser?.ownerGlobal||browser?.ownerDocument?.defaultView;
    if(!w?.gBrowser || w.gBrowser.selectedBrowser!==browser)return;
    if(message.name==='VideoPresentation'){cursorFor(w).presentation(this.manager,message.data);return;}
    if(message.name==='CursorStatus')return cursorFor(w).status();
    if(message.name==='FullscreenState')cursorFor(w).state(this.manager,message.data);
    if(message.name==='VideoActivity')cursorFor(w).activity({type:message.data?.kind||'mousemove'});
  }
}
