#!/usr/bin/env python3
"""Isolated installer/restore/compatibility tests. Never targets the live profile."""
import json,plistlib,subprocess,tempfile,os,pathlib,hashlib,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
binary=root/'build/Zen Companion.app/Contents/MacOS/ZenCompanion'
sandbox=pathlib.Path(tempfile.mkdtemp(prefix='zen-companion-test-'))
profile=sandbox/'profile';profile.mkdir();(profile/'chrome').mkdir();(profile/'prefs.js').write_text('user_pref("mod.zenliquid.transparency", "70%");\nuser_pref("unrelated", true);\n');(profile/'user.js').write_text('// unrelated config\n');(profile/'chrome/userContent.css').write_text('/* unrelated stylesheet */\n')
(profile/'chrome/zen-themes/other').mkdir(parents=True);(profile/'chrome/zen-themes/other/chrome.css').write_text('/* unrelated mod */')
(profile/'zen-themes.json').write_text(json.dumps({'other':{'id':'other','enabled':True}}))
app=sandbox/'Zen.app';res=app/'Contents/Resources';res.mkdir(parents=True)
tested=json.loads((root/'Resources/compatibility.json').read_text())['testedZen'][0]
(app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'app.zen-browser.zen','CFBundleShortVersionString':tested['version'],'CFBundleVersion':tested['bundleBuild']}))
(res/'application.ini').write_text('Version='+tested['version']+'\nBuildID='+tested['buildID']+'\n')
with zipfile.ZipFile(res/'omni.ja','w') as z:
 z.writestr('actors/TranslationsParent.sys.mjs','async getLangTags() async translate( restorePage()')
 z.writestr('moz-src/toolkit/components/pictureinpicture/PictureInPicture.sys.mjs','async openPipWindow( async handlePictureInPictureRequest( win.setupPlayer(')
archive=(res/'omni.ja').read_bytes()
base=sandbox/'state'
def run(*args,ok=True):
 r=subprocess.run([str(binary),'--base',str(base),'--profile',str(profile),'--zen',str(app),*args],capture_output=True,text=True)
 if ok:assert r.returncode==0,(args,r.stderr,r.stdout)
 else:assert r.returncode!=0,(args,r.stdout)
 return r
before={str(p.relative_to(profile)):p.read_bytes() for p in profile.rglob('*') if p.is_file()}
run('--install');settings=json.loads((profile/'ultimate-glass-settings.json').read_text());assert settings['transparency']==70
assert json.loads((profile/'chrome/zen-themes/e09b652e-7abc-47aa-94e0-91d5a35f625c/preferences.json').read_text())==[]
assert (profile/'prefs.js').read_bytes()==before['prefs.js'];assert 'unrelated mod' in (profile/'chrome/zen-themes.css').read_text()
run('--set','60','--enabled','false');assert json.loads((profile/'ultimate-glass-settings.json').read_text())['enabled'] is False
assert json.loads(run('--status').stdout)['restartRequired']
# Unknown Zen is blocked even when our loader remains present.
info=app/'Contents/Info.plist';original=info.read_bytes();meta=plistlib.loads(original);meta['CFBundleShortVersionString']='99.0';info.write_bytes(plistlib.dumps(meta))
assert json.loads(run('--guard').stdout)['status']=='blocked'
run('--install',ok=False);info.write_bytes(original)
# A foreign loader is never overwritten.
foreign=res/'defaults/pref/foreign.js';foreign.parent.mkdir(parents=True,exist_ok=True);foreign.write_text('pref("general.config.filename", "foreign.cfg");')
run('--install',ok=False);assert foreign.read_text().endswith(';');foreign.unlink()
# Restoring the migration backup returns owned profile files byte-for-byte.
run('--restore')
for p,data in before.items():assert (profile/p).read_bytes()==data,p
assert not (profile/'ultimate-glass-settings.json').exists()
assert not (res/'ultimate-video.cfg').exists()
# Failed native API check makes no profile changes.
(res/'omni.ja').unlink();(res/'omni.ja').write_bytes(b'invalid archive')
run('--install',ok=False)
for p,data in before.items():assert (profile/p).read_bytes()==data,p
(res/'omni.ja').write_bytes(archive)
run('--install');run('--uninstall')
assert 'unrelated' in (profile/'prefs.js').read_text()
assert json.loads((profile/'zen-themes.json').read_text())=={'other':{'id':'other','enabled':True}}
assert 'unrelated stylesheet' in (profile/'chrome/userContent.css').read_text()
assert not (profile/'chrome/ultimate-glass-video').exists()
print('PASS: migration70%, settings, empty mod UI, unrelated data, unknown version, foreign loader, restore, API failure')
print('Test data:',sandbox)
