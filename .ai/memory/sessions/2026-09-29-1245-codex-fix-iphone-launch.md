# Fix physical iPhone launch on iOS 27

## Outcome
- Diagnosed the launch exit as UIKit `NoSceneLifecycleAdoption`: Xcode 27/iOS 27
  requires the scene lifecycle, while this app used Expo SDK 57.0.3's legacy template.
- Updated Expo to 57.0.25, added `expo-build-properties` 57.0.22, enabled
  `ios.enableSceneSupport`, and regenerated the native iOS project. The generated
  Info.plist now declares `EXExpoAppSceneDelegate`, and AppDelegate provides the
  React Native factory for Expo's scene delegate.
- The app then reached JavaScript but ULID threw `PRNG_DETECT` because React Native
  lacked `crypto.getRandomValues`. Added `react-native-get-random-values` 2.0.0 and
  loaded it from `apps/mobile/index.js` before `expo-router/entry`.
- Installed Pods, built with Xcode 27, installed and launched on the connected iPhone.
  Metro reported `iOS Bundled ... apps/mobile/index.js`, and a device screenshot showed
  the OpenBot Settings screen. Metro remains running for this dev build.

## Verification
- Physical device build completed and app installation succeeded.
- Device process remained alive; screenshot showed the rendered app UI.
- No test suites were run; this task verified native build/install/launch only.

## Next steps
- Exercise pairing and a conversation on the physical phone.
- For future Xcode 27 builds, keep Expo scene support and the random-values polyfill;
  make sure Pods are installed and Metro is serving the development build.

## Retro
- Reading the device crash report identified the native failure directly; the first
  successful native launch exposed a separate JS startup dependency immediately.
- The prior environment notes had not been updated after Xcode license acceptance and
  device discovery. Keep STATE aligned as environment prerequisites change.
- An initial prebuild regenerated the native project and required CocoaPods to restore
  generated workspace artifacts; verify repository status after prebuild/pod install.
