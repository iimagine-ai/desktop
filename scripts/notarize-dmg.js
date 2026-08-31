/**
 * electron-builder afterAllArtifactBuild hook (macOS).
 *
 * The afterSign hook (scripts/notarize.js) notarizes and staples the .app, but
 * the DMG is built AFTER that hook runs, so the DMG file itself carries no
 * stapled ticket. A .app stapled inside the DMG already opens without a
 * Gatekeeper warning, but stapling the DMG too lets it validate offline before
 * it is ever opened. This hook submits each built .dmg to Apple's notary
 * service and staples the returned ticket onto it.
 *
 * Credentials come from the environment (same as notarize.js):
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
 * When they are absent, the hook is a no-op (local unsigned dev builds).
 */

const { execFileSync } = require("child_process");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) return [];

  if (!appleId || !applePassword || !teamId) {
    console.log(
      "[notarize-dmg] notary credentials not set — skipping DMG notarization."
    );
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] submitting ${dmg} to Apple notary service...`);
    execFileSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        dmg,
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

    console.log(`[notarize-dmg] stapling ticket onto ${dmg}...`);
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }

  console.log("[notarize-dmg] done.");
  // Returning [] tells electron-builder we did not create new artifacts.
  return [];
};
