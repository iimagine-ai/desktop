/**
 * electron-builder afterSign hook (macOS).
 *
 * Runs after electron-builder has signed the Electron app itself, but the
 * native binaries we ship in `bin/` via `extraResources` are NOT signed by
 * electron-builder. macOS notarization requires every Mach-O executable and
 * dylib inside the bundle to be signed with the hardened runtime, so this
 * hook does two things, in order:
 *
 *   1. Deep-sign every binary/dylib under Contents/Resources/bin with our
 *      Developer ID Application identity + hardened runtime + entitlements.
 *   2. Submit the whole .app to Apple's notary service and staple the ticket.
 *
 * All credentials come from the environment — nothing is hardcoded:
 *   - SIGNING_IDENTITY             Full "Developer ID Application: Name (TEAMID)"
 *                                  identity used by codesign for the bundled
 *                                  binaries. (electron-builder itself uses the
 *                                  unprefixed CSC_NAME, which is why this hook
 *                                  has its own variable.)
 *   - APPLE_ID                     Apple ID email used for notarization
 *   - APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
 *   - APPLE_TEAM_ID                10-char Apple Developer Team ID
 *
 * If the notarization credentials are absent the hook signs the bundled
 * binaries and skips notarization (useful for local unsigned dev builds),
 * printing a clear notice rather than failing the build.
 */

const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");

const ENTITLEMENTS = path.join(__dirname, "..", "assets", "entitlements.mac.plist");

/** Return true if the file at `filePath` is a Mach-O binary (executable or dylib). */
function isMachO(filePath) {
  try {
    const out = execFileSync("file", ["-b", filePath], { encoding: "utf8" });
    return out.includes("Mach-O");
  } catch {
    return false;
  }
}

/** Recursively collect every regular file under `dir`. */
function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** codesign a single Mach-O file with hardened runtime + entitlements. */
function signBinary(filePath, identity) {
  const args = [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    ENTITLEMENTS,
    "--sign",
    identity,
    filePath,
  ];
  execFileSync("codesign", args, { stdio: "inherit" });
}

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const binDir = path.join(appPath, "Contents", "Resources", "bin");

  // codesign wants the full "Developer ID Application: Name (TEAMID)" identity.
  // Prefer SIGNING_IDENTITY; otherwise derive it from CSC_NAME (+ TEAM_ID) which
  // electron-builder requires WITHOUT the prefix.
  let identity = process.env.SIGNING_IDENTITY;
  if (!identity) {
    const cscName = process.env.CSC_NAME;
    identity = cscName
      ? `Developer ID Application: ${cscName}`
      : "Developer ID Application";
  }

  // --- Step 1: sign every bundled native binary in bin/ ---
  if (fs.existsSync(binDir)) {
    const machoFiles = walk(binDir).filter(isMachO);
    console.log(`[notarize] signing ${machoFiles.length} bundled binaries in bin/`);
    for (const file of machoFiles) {
      signBinary(file, identity);
    }
  } else {
    console.log(`[notarize] no bin/ directory at ${binDir} — skipping binary signing`);
  }

  // Re-sign the app bundle itself last so it seals the freshly signed bin/.
  signBinary(appPath, identity);

  // --- Step 2: notarize + staple ---
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    console.log(
      "[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — " +
        "skipping notarization (signed build only, will still show Gatekeeper warning)."
    );
    return;
  }

  // notarytool only accepts a .zip, .pkg, or .dmg — not a raw .app bundle.
  // Zip the app (ditto preserves the code signature + symlinks), submit the
  // zip, then staple the ticket back onto the .app itself.
  const zipPath = path.join(appOutDir, `${appName}.notarize.zip`);
  console.log(`[notarize] zipping app for submission...`);
  execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath], {
    stdio: "inherit",
  });

  console.log(`[notarize] submitting ${appName}.app to Apple notary service...`);
  execFileSync(
    "xcrun",
    [
      "notarytool",
      "submit",
      zipPath,
      "--apple-id",
      appleId,
      "--password",
      applePassword,
      "--team-id",
      teamId,
      "--wait",
    ],
    { stdio: "inherit" }
  );

  // The ticket is stapled onto the .app (not the zip); electron-builder then
  // packages the stapled .app into the final DMG. The DMG itself is notarized
  // + stapled separately by scripts/notarize-dmg.js (afterAllArtifactBuild),
  // because the DMG does not exist yet at this point.
  console.log("[notarize] stapling ticket onto .app...");
  execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });

  fs.rmSync(zipPath, { force: true });
  console.log("[notarize] app notarized + stapled.");
};
