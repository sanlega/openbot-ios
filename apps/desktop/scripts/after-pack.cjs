/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder 25 loads hooks with require() */
// electron-builder `afterPack` hook: ad-hoc sign the macOS app.
//
// Releases are built without an Apple Developer ID (CSC_IDENTITY_AUTO_DISCOVERY=false), so
// electron-builder skips signing and leaves Electron's signature broken by the bundle changes
// (Info.plist, app.asar, native modules). On Apple Silicon, macOS refuses such a download as
// "OpenBot is damaged and can't be opened", with no way past it. An ad-hoc signature makes the
// bundle valid: the first launch then shows the usual "unidentified developer" prompt, which
// the user can allow in System Settings > Privacy & Security.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = join(__dirname, "..", "resources", "entitlements.mac.plist");
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, app],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    stdio: "inherit",
  });
};
