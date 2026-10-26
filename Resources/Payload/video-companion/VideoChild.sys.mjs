export class UltimateGlassVideoChild extends JSWindowActorChild {
  findFullscreenVideo(){
    const fs=this.document.fullscreenElement;
    if(!fs&&!this.chromeFullscreen)return null;
    const cached=this.fullscreenVideo?.get();if(cached?.isConnected)return cached;
    const scope=fs||this.document;
    const videos=[];
    const visit=root=>{
      if(root.localName==='video')videos.push(root);
      for(const node of root.querySelectorAll('*')){
        if(node.localName==='video')videos.push(node);
        if(node.localName!=='video'&&node.openOrClosedShadowRoot)visit(node.openOrClosedShadowRoot);
      }
    };
    if(fs||this.chromeFullscreen)visit(scope);
    const found=videos.filter(v=>v.getBoundingClientRect().width>0).sort((a,b)=>(!b.paused-!a.paused)||b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0]||null;
    this.fullscreenVideo=found?Cu.getWeakReference(found):null;return found;
  }
  watchPresentation(candidate=null){
    if(candidate?.localName==='video')this.presentationVideo=Cu.getWeakReference(candidate);
    let video=this.presentationVideo?.get();
    if(!video?.isConnected){
      if(candidate?.localName!=='video'&&Date.now()-(this.noPresentationVideoAt||0)<1000)return;
      const found=[];const visit=root=>{for(const node of root.querySelectorAll('*')){if(node.localName==='video')found.push(node);else if(node.openOrClosedShadowRoot)visit(node.openOrClosedShadowRoot);}};
      visit(this.document);video=found.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
      this.presentationVideo=video?Cu.getWeakReference(video):null;
    }
    if(!video){this.noPresentationVideoAt=Date.now();return;}
    if(this.presentationObserved!==video){
      this.stopPresentation();this.presentationObserved=video;
      this.presentationChanged=()=>{
        if(this.presentationTimer)return;
        this.presentationTimer=this.contentWindow.setTimeout(()=>{this.presentationTimer=null;this.reportPresentation();},100);
      };
      this.presentationResize=new this.contentWindow.ResizeObserver(this.presentationChanged);
      this.presentationResize.observe(video);
      this.presentationAttrs=new this.contentWindow.MutationObserver(this.presentationChanged);
      for(let el=video;el;el=el.parentElement||el.getRootNode()?.host){this.presentationAttrs.observe(el,{attributes:true,attributeFilter:['class','style']});this.presentationResize.observe(el);}
      this.contentWindow.addEventListener('resize',this.presentationChanged);
      this.contentWindow.addEventListener('scroll',this.presentationChanged,true);
    }
    this.reportPresentation();
    if(!this.playerUITimer)this.playerUITimer=this.contentWindow.setInterval(()=>this.syncPlayerUI(),80);
    this.syncPlayerUI();
  }
  reportPresentation(){
    const v=this.presentationVideo?.get(),w=this.contentWindow;
    if(v?.isConnected&&!v.isCloningElementVisually){
      const r=v.getBoundingClientRect();
      const covers=r.width>=w.innerWidth-8&&r.height>=w.innerHeight-8&&Math.abs(r.x)<=8&&Math.abs(r.y)<=8;
      this.sendAsyncMessage('VideoPresentation',{video:true,pageSized:covers,x:w.mozInnerScreenX+r.x,y:w.mozInnerScreenY+r.y,width:r.width,height:r.height});
    }else this.sendAsyncMessage('VideoPresentation',{video:false,pageSized:false});
  }
  playerElementVisible(el){
    if(!el||!el.isConnected)return false;
    const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
    for(let n=el;n;n=n.parentElement||n.getRootNode()?.host){
      const s=this.contentWindow.getComputedStyle(n);
      if(n.hidden||s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)<=.01)return false;
    }
    return true;
  }
  syncPlayerUI(){
    const v=this.presentationVideo?.get()||this.trackedVideo?.get();
    if(!v?.isConnected||!Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true)){this.stopPresentation();return;}
    const shadow=v.openOrClosedShadowRoot,controls=shadow?.querySelector('.videocontrols');
    let visible=false,source='video-css';
    const youtube=v.closest('.html5-video-player'),ani=v.closest('.video-layout');
    if(youtube?.querySelector('.ytp-chrome-bottom')){
      source='youtube-controls';visible=!youtube.classList.contains('ytp-autohide')&&this.playerElementVisible(youtube.querySelector('.ytp-chrome-bottom'));
    }else if(ani?.querySelector('.interface-top, .interface-bottom')){
      source='aniliberty-controls';visible=[...ani.querySelectorAll('.interface-top, .interface-bottom')].some(el=>this.playerElementVisible(el));
    }else if(v.controls&&controls?.querySelector('.controlBar')){
      source='native-controls';visible=this.playerElementVisible(controls.querySelector('.controlBar'));
    }else{
      // Okko publishes cursor:none on a sibling overlay, not on <video>.
      // Read the actual page surface at the visible video's centre; do not
      // depend on hashed site classes or the physical pointer's location.
      source='player-surface-css';
      const w=this.contentWindow,r=v.getBoundingClientRect();
      const left=Math.max(0,r.left),right=Math.min(w.innerWidth,r.right);
      const top=Math.max(0,r.top),bottom=Math.min(w.innerHeight,r.bottom);
      if(right>left&&bottom>top){
        const x=(left+right)/2,y=(top+bottom)/2;
        let surface=this.document.elementFromPoint(x,y);
        for(let i=0;surface&&surface!==v&&i<16;i++){
          const shadow=surface.openOrClosedShadowRoot;
          const next=shadow?.elementFromPoint?.(x,y);if(!next||next===surface)break;surface=next;
        }
        visible=!!surface&&w.getComputedStyle(surface).cursor!=='none';
      }
    }
    this.playerUIState={visible,source};
    if(this.playerUIControls&&this.playerUIControls!==controls)this.playerUIControls.removeAttribute('data-ultimate-player-ui');
    this.playerUIControls=controls;
    const value=visible?'visible':'hidden';
    if(controls&&controls.getAttribute('data-ultimate-player-ui')!==value)controls.setAttribute('data-ultimate-player-ui',value);
    return this.playerUIState;
  }
  stopPresentation(){
    if(this.playerUITimer)this.contentWindow.clearInterval(this.playerUITimer);
    this.playerUITimer=null;
    this.playerUIControls?.removeAttribute('data-ultimate-player-ui');this.playerUIControls=null;this.playerUIState=null;
    this.presentationResize?.disconnect();this.presentationAttrs?.disconnect();
    if(this.presentationChanged){this.contentWindow.removeEventListener('resize',this.presentationChanged);this.contentWindow.removeEventListener('scroll',this.presentationChanged,true);}
    if(this.presentationTimer)this.contentWindow.clearTimeout(this.presentationTimer);
    this.presentationTimer=null;this.presentationObserved=null;
  }
  readCursor(point){
    const w=this.contentWindow,rawX=point.x-w.mozInnerScreenX,rawY=point.y-w.mozInnerScreenY;
    if(rawX<0||rawY<0||rawX>w.innerWidth||rawY>w.innerHeight||w.innerWidth<=0||w.innerHeight<=0)return {inside:false};
    // Quartz can place the hotspot exactly on the display boundary. DOM hit testing
    // uses a half-open viewport; sample the final device pixel, never outside it.
    const pixel=1/(w.devicePixelRatio||1);
    const x=Math.min(rawX,w.innerWidth-pixel),y=Math.min(rawY,w.innerHeight-pixel);
    let node=this.document.elementFromPoint(x,y);
    if(!node)return {inside:false};
    for(let i=0;i<16;i++){
      const shadow=node.openOrClosedShadowRoot;
      if(!shadow?.elementFromPoint)break;
      const next=shadow.elementFromPoint(x,y);if(!next||next===node)break;node=next;
    }
    let child=null;
    if(node.localName==='iframe'||node.localName==='frame')child=node.browsingContext?.id||null;
    const css=w.getComputedStyle(node).cursor;
    return {inside:true,css:css.includes('url(')?'custom':css,child};
  }
  receiveMessage(message) {
    if(message.name==='CursorPolicy')return this.readCursor(message.data);
    if(message.name==='PlayerUIState')return this.syncPlayerUI();
    if(message.name==='WatchPresentation'){this.watchPresentation();return;}
    if(message.name==='FullscreenContext'){
      this.chromeFullscreen=message.data.active;
      this.handleEvent({type:'fullscreenchange'});
      return;
    }
    if(message.name==='Candidate') {
      const {PictureInPictureChild}=ChromeUtils.importESModule('moz-src:///toolkit/actors/PictureInPictureChild.sys.mjs');
      const launcher=this.manager.getActor('PictureInPictureLauncher');
      const v=launcher.findVideoToPiP(this.document);
      this.candidateVideo=v?Cu.getWeakReference(v):null;
      return v&&!v.muted&&PictureInPictureChild.videoIsPlaying(v)&&PictureInPictureChild.videoIsPiPEligible(v)?v.clientWidth*v.clientHeight:0;
    }
    if(message.name==='PlaybackState'){const v=this.candidateVideo?.get();return {cloning:!!v?.isCloningElementVisually,paused:v?.paused??true};}
    if(message.name==='Restore') {
      const v=this.candidateVideo?.get();
      if(v?.isCloningElementVisually)v.stopCloningElementVisually();
    }
    if(message.name==='CursorIdle')this.setIdle(message.data.idle);
  }
  setIdle(idle) {
    this.idle=idle;
    const fs=this.document.fullscreenElement;
    if(fs)fs.toggleAttribute('data-ultimate-video-idle',idle);
    this.document.documentElement.toggleAttribute('data-ultimate-video-idle',!!this.chromeFullscreen&&idle);

  }
  bindControls(video){
    if(this.trackedVideo?.get()!==video){
      const old=this.trackedVideo?.get();
      if(old&&this.playbackListener)for(const name of ['play','pause','ended'])old.removeEventListener(name,this.playbackListener);
      this.trackedVideo=Cu.getWeakReference(video);
      this.playbackListener=event=>this.handleEvent(event);
      // Media events inside a closed author shadow tree do not reach the actor's document listener.
      if(video.getRootNode()!==this.document)for(const name of ['play','pause','ended'])video.addEventListener(name,this.playbackListener);
    }
    const shadow=video.openOrClosedShadowRoot;
    if(!shadow)return;
    if(this.observedShadow!==shadow){
      this.controlObserver?.disconnect();this.observedShadow=shadow;
      this.controlObserver=new this.contentWindow.MutationObserver(()=>this.bindControls(video));
      this.controlObserver.observe(shadow,{chromeOnlyNodes:true,subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inDOMFullscreen']});
    }
    const controls=shadow.querySelector('.videocontrols');
    if(controls&&controls!==this.controls){
      this.controls=controls;this.toggle=controls.querySelector('#pictureInPictureToggle');this.originalHidden=this.toggle?.hidden;
    }
    if(this.toggle&&this.toggle.hidden&&Services.prefs.getBoolPref('media.videocontrols.picture-in-picture.video-toggle.enabled',true)&&!video.isCloningElementVisually&&this.toggle.getAttribute('policy')!=='hidden')this.toggle.hidden=false;
    if(this.controls)this.controls.setAttribute('data-ultimate-fullscreen-video','active');
    this.syncPlayerUI();
    this.setIdle(!!this.idle);
  }

  cleanup() {
    const tracked=this.trackedVideo?.get();
    if(tracked&&this.playbackListener)for(const name of ['play','pause','ended'])tracked.removeEventListener(name,this.playbackListener);
    this.trackedVideo=null;this.playbackListener=null;
    this.controlObserver?.disconnect();this.controlObserver=null;this.observedShadow=null;this.idle=false;
    if(this.timer)this.contentWindow.clearTimeout(this.timer);
    this.timer=null;
    for(const el of this.document.querySelectorAll('[data-ultimate-video-idle]'))el.removeAttribute('data-ultimate-video-idle');
    if(this.controls)this.controls.removeAttribute('data-ultimate-fullscreen-video');
    if(this.toggle&&this.originalHidden!=null)this.toggle.hidden=this.originalHidden;
    this.controls=null;this.toggle=null;this.originalHidden=null;
  }
  handleEvent(event) {
    const d=this.document,w=this.contentWindow;
    if(event.type==='visibilitychange')this.syncPlayerUI();
    if(['play','loadedmetadata','DOMContentLoaded','pageshow'].includes(event.type))this.watchPresentation(event.target);
    if(event.type==='pagehide'){this.stopPresentation();this.sendAsyncMessage('VideoPresentation',{video:false,pageSized:false});}
    if(event.type==='fullscreenchange'||event.type==='pagehide')this.fullscreenVideo=null;
    if(event.type==='play'&&event.target?.localName==='video')this.fullscreenVideo=Cu.getWeakReference(event.target);
    if(event.type==='mousemove'&&Number.isFinite(event.screenX)&&Number.isFinite(event.screenY)){
      if(event.screenX===this.lastX&&event.screenY===this.lastY&&(!this.idle||!event.isTrusted))return;
      this.lastX=event.screenX;this.lastY=event.screenY;
    }
    if(!Services.prefs.getBoolPref('mod.zenliquid.video-companion.enabled',true)){this.cleanup();return;}
    const fs=d.fullscreenElement;
    const video=this.findFullscreenVideo();
    if(event.type==='pagehide'||!video){this.cleanup();if(this.wasVideoFullscreen)this.sendAsyncMessage('FullscreenState',{video:false,playing:false});this.wasVideoFullscreen=false;return;}
    this.wasVideoFullscreen=true;
    this.bindControls(video);
    const playing=!video.paused&&!video.ended;
    if(event.type==='fullscreenchange'||event.type==='play'||event.type==='pause'||event.type==='ended')this.sendAsyncMessage('FullscreenState',{video:true,playing,score:video.clientWidth*video.clientHeight});
    else if(!this.lastActivity||Date.now()-this.lastActivity>32){this.lastActivity=Date.now();this.sendAsyncMessage('VideoActivity',{kind:event.type});}

  }
  didDestroy(){try{this.stopPresentation();this.cleanup();}catch{}}
}
