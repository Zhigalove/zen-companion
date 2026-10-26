#!/bin/zsh
set -eu
cd "${0:A:h}"
app="${ZEN_COMPANION_OUTPUT:-build/Zen Companion.app}"
version=$(/usr/bin/plutil -extract appVersion raw Resources/compatibility.json)
[[ "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]
/usr/bin/sed -i '' -E "s/const bridgeVersion = '[^']*';/const bridgeVersion = '$version';/" Resources/Payload/video-companion/AppSettings.sys.mjs
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
/usr/bin/ditto Resources "$app/Contents/Resources"
xcrun swiftc -swift-version 5 -O -target "${ZEN_COMPANION_ARCH:-arm64}-apple-macosx14.0" Sources/*.swift -o "$app/Contents/MacOS/ZenCompanion" -framework SwiftUI -framework AppKit
/bin/rm -f "$app/Contents/Info.plist"
/usr/bin/plutil -create xml1 "$app/Contents/Info.plist"
for pair in 'CFBundleIdentifier=local.zen-companion.manager' 'CFBundleName=Zen Companion' 'CFBundleDisplayName=Zen Companion' 'CFBundleExecutable=ZenCompanion' "CFBundleShortVersionString=$version" 'CFBundleVersion=1' 'CFBundlePackageType=APPL' 'LSMinimumSystemVersion=14.0' 'NSPrincipalClass=NSApplication'; do
 /usr/libexec/PlistBuddy -c "Add :${pair%%=*} string ${pair#*=}" "$app/Contents/Info.plist"
done
xcrun swift Tools/Icon.swift "$app/Contents/Resources/AppIcon.icns"
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
echo "Built $app"
