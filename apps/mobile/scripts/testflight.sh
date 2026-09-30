#!/usr/bin/env bash
# Archives the iPhone app and uploads it to App Store Connect for TestFlight.
#
#   TEAM_ID=<team-id> apps/mobile/scripts/testflight.sh            # archive + upload
#   TEAM_ID=<team-id> apps/mobile/scripts/testflight.sh --no-upload  # archive + export only
#
# Needs a paid Apple Developer team, the app record for `ai.openbot.mobile` in App Store
# Connect, and that Apple ID signed in to Xcode (Settings > Accounts): Xcode's automatic
# signing creates the distribution certificate and profile, and the upload uses the
# same account. The build number is the current UTC time, so every upload is newer.
set -euo pipefail

: "${TEAM_ID:?Set TEAM_ID to your Apple Developer team ID}"
UPLOAD=1
[[ "${1:-}" == "--no-upload" ]] && UPLOAD=0

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/ios/build/testflight"
BUILD_NUMBER="$(date -u +%Y%m%d%H%M)"
mkdir -p "$OUT"

cd "$HERE/ios"
pod install >/dev/null

xcodebuild -workspace OpenBot.xcworkspace -scheme OpenBot -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/OpenBot.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGN_ENTITLEMENTS=OpenBot/OpenBotPush.entitlements \
  -allowProvisioningUpdates archive

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([[ $UPLOAD == 1 ]] && echo upload || echo export)</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>testFlightInternalTestingOnly</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive -archivePath "$OUT/OpenBot.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" \
  -allowProvisioningUpdates

if [[ $UPLOAD == 1 ]]; then
  echo "Uploaded build $BUILD_NUMBER. It shows in TestFlight after Apple finishes processing (usually 5-15 minutes)."
else
  echo "Exported $OUT/export (build $BUILD_NUMBER); not uploaded."
fi
