// Compatibility entry point retained for existing installations.
// Universal appearance is plain CSS material; it never captures page pixels.
export function setUniversalMaterial(){
 for(const w of Services.wm.getEnumerator('navigator:browser')){
  for(const n of w.document.querySelectorAll('[data-lg-material]')){
   n.removeAttribute('data-lg-material');n.style.removeProperty('--lg-live-backdrop');
  }
  for(const n of w.document.querySelectorAll('[data-lg-ink]')){
   n.removeAttribute('data-lg-ink');n.style.removeProperty('--lg-local-ink');
  }
 }
}
export function materialStatus(){return {active:false,captures:0};}
