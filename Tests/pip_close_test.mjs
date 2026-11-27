import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs
  .readFileSync(
    new URL('../Resources/Payload/video-companion/VideoCompanion.sys.mjs', import.meta.url),
    'utf8'
  )
  .replace(/^import .*;\n/gm, '')
  .replace(/export function /g, 'function ')
  .replace(/^export \{.*$/gm, '');

const tabs = new Map();
const tabListeners = new Map();
const winListeners = new Map();
let selectedBrowser;
let pipWindows = [];
let autoToggleCount = 0;
let nativeOpenCount = 0;
let nativeRequestMode = 'normal';
let pendingCandidate = null;
let onOpenHook = null;

function makeBrowser(id, score = 1000) {
  const tab = { closing: false };
  let browser;
  const global = {
    isClosed: false,
    browsingContext: null,
    getActor(name) {
      if (name === 'UltimateGlassVideo') {
        return {
          sendAsyncMessage() {},
          async sendQuery(msg) {
            if (msg === 'Candidate') {
              if (pendingCandidate) await pendingCandidate;
              return score;
            }
            return null;
          },
        };
      }
      if (name === 'PictureInPictureLauncher') {
        return {
          sendAsyncMessage(msg) {
            if (msg === 'PictureInPicture:AutoToggle') autoToggleCount++;
          },
        };
      }
      return { sendAsyncMessage() {} };
    },
  };
  const bc = {
    isDiscarded: false,
    currentWindowGlobal: global,
    getAllBrowsingContextsInSubtree: () => [bc],
    top: null,
  };
  browser = {
    id,
    isConnected: true,
    audioMuted: false,
    browsingContext: bc,
    documentGlobal: null,
    ownerGlobal: null,
    _tab: tab,
    _global: global,
  };
  bc.top = { embedderElement: browser };
  global.browsingContext = bc;
  tab.linkedBrowser = browser;
  tabs.set(browser, tab);
  return browser;
}

const w = {
  closed: false,
  document: { hasFocus: () => true },
  windowUtils: { isWindowFullyOccluded: false },
  gBrowser: {
    get selectedBrowser() {
      return selectedBrowser;
    },
    getTabForBrowser: b => tabs.get(b) || null,
    tabContainer: {
      addEventListener(name, fn) {
        if (!tabListeners.has(name)) tabListeners.set(name, []);
        tabListeners.get(name).push(fn);
      },
      removeEventListener() {},
    },
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
  setInterval: () => 1,
  clearInterval() {},
  addEventListener(name, fn) {
    if (!winListeners.has(name)) winListeners.set(name, []);
    winListeners.get(name).push(fn);
  },
  removeEventListener() {},
};

const PictureInPicture = {
  async openPipWindow() {
    nativeOpenCount++;
    const player = {
      closed: false,
      close() {
        this.closed = true;
      },
      setupPlayer() {
        return { actor: {}, setupPromise: Promise.resolve() };
      },
    };
    pipWindows.push(player);
    if (onOpenHook) onOpenHook(player);
    return player;
  },
  async handlePictureInPictureRequest(global, data) {
    const player = await PictureInPicture.openPipWindow(w, data);
    if (nativeRequestMode === 'throw-before-setup') {
      throw new TypeError("can't access property \"setAttribute\", tab is null");
    }
    player.setupPlayer();
    return player;
  },
  async closePipWindow(player) {
    player.closed = true;
  },
};

const context = {
  Services: {
    focus: { activeWindow: w },
    prefs: { getBoolPref: () => true, getDefaultBranch: () => ({ setBoolPref() {} }) },
    wm: {
      getEnumerator: type => (type === 'Toolkit:PictureInPicture' ? pipWindows.filter(p => !p.closed) : []),
      getMostRecentWindow: () => w,
    },
  },
  ChromeUtils: {
    importESModule: () => ({ PictureInPicture }),
    registerWindowActor() {},
  },
  applicationIsActive: () => true,
  fullscreenCursorFor: () => ({}),
  startPipPlacement: () => {},
  attachPageMenu: () => {},
  console,
  Date,
  Map,
  WeakMap,
  WeakSet,
  Promise,
  Error,
};

vm.createContext(context);
vm.runInContext(source, context);

const b1 = makeBrowser('b1');
const b2 = makeBrowser('b2', 0);
b1.documentGlobal = b1.ownerGlobal = w;
b2.documentGlobal = b2.ownerGlobal = w;
selectedBrowser = b1;

const controller = context.attach(w);
const fireTab = (name, detail) => {
  for (const fn of tabListeners.get(name) || []) fn(detail);
};
const settle = () => new Promise(r => setTimeout(r, 25));

// 1. Closing active tab (tab.closing = true before TabSelect) must not trigger AutoToggle.
b1._tab.closing = true;
selectedBrowser = b2;
fireTab('TabSelect', { type: 'TabSelect' });
await controller.check();
await settle();
assert.equal(autoToggleCount, 0, 'closing tab must not trigger AutoToggle');

// 2. TabClose during in-flight Candidate query aborts before AutoToggle.
const b3 = makeBrowser('b3');
b3.documentGlobal = b3.ownerGlobal = w;
selectedBrowser = b3;
await controller.check();
let releaseCandidate;
pendingCandidate = new Promise(r => (releaseCandidate = r));
selectedBrowser = b2;
const checkPromise = controller.check();
b3._tab.closing = true;
fireTab('TabClose', { target: b3._tab });
releaseCandidate();
pendingCandidate = null;
await checkPromise;
await settle();
assert.equal(autoToggleCount, 0, 'tab closed during Candidate query must not trigger AutoToggle');

// 3. TabClose after AutoToggle was sent aborts handlePictureInPictureRequest before openPipWindow.
const b4 = makeBrowser('b4');
b4.documentGlobal = b4.ownerGlobal = w;
selectedBrowser = b4;
await controller.check();
selectedBrowser = b2;
const p4 = controller.check();
await settle();
assert.equal(autoToggleCount, 1, 'open tab switch triggers AutoToggle');
b4._tab.closing = true;
fireTab('TabClose', { target: b4._tab });
await PictureInPicture.handlePictureInPictureRequest(b4._global, {});
await p4;
assert.equal(nativeOpenCount, 0, 'cancelled auto-PiP must not open a PiP window');

// 4. Tab closes while openPipWindow is resolving -> orphaned PiP window is closed immediately.
const b5 = makeBrowser('b5');
b5.documentGlobal = b5.ownerGlobal = w;
selectedBrowser = b5;
await controller.check();
selectedBrowser = b2;
const p5 = controller.check();
await settle();
assert.equal(autoToggleCount, 2);
onOpenHook = () => {
  b5._tab.closing = true;
  b5.isConnected = false;
};
nativeRequestMode = 'throw-before-setup';
await PictureInPicture.handlePictureInPictureRequest(b5._global, {});
onOpenHook = null;
nativeRequestMode = 'normal';
await p5;
assert.equal(pipWindows.filter(p => !p.closed).length, 0, 'orphaned PiP window must be closed');

// 5. Normal tab switch opens PiP and returning to the tab closes it cleanly.
const b6 = makeBrowser('b6');
b6.documentGlobal = b6.ownerGlobal = w;
selectedBrowser = b6;
await controller.check();
selectedBrowser = b2;
const p6 = controller.check();
await settle();
assert.equal(autoToggleCount, 3);
await PictureInPicture.handlePictureInPictureRequest(b6._global, {});
await p6;
assert.equal(pipWindows.filter(p => !p.closed).length, 1, 'normal tab switch keeps PiP window open');
selectedBrowser = b6;
fireTab('TabSelect', { type: 'TabSelect' });
await settle();
assert.equal(pipWindows.filter(p => !p.closed).length, 0, 'returning to source tab closes PiP window');

controller.stop();
console.log('PASS pip close protection: closing tab, mid-query close, post-AutoToggle cancel, orphan cleanup and normal return');
