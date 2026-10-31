import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEV_BUNDLE_IDENTIFIER = "com.tomz.uichat.dev";
const DEV_BUNDLE_NAME = "UIChat Mira Dev";
const DEV_PROTOCOL_SCHEME = "mira-desktop";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/" +
  "LaunchServices.framework/Support/lsregister";

function runCodesign(args, stdio = "inherit") {
  execFileSync("/usr/bin/codesign", args, { stdio });
}

function resolveElectronAppPath() {
  const electronPackagePath = require.resolve("electron/package.json");
  return path.join(path.dirname(electronPackagePath), "dist", "Electron.app");
}

function readInfoPlist(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const raw = execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", plistPath],
    { encoding: "utf8" },
  );
  return { plistPath, value: JSON.parse(raw) };
}

function hasDevProtocolMetadata(plist) {
  const urlTypes = Array.isArray(plist.CFBundleURLTypes)
    ? plist.CFBundleURLTypes
    : [];
  const protocol = urlTypes.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Array.isArray(entry.CFBundleURLSchemes) &&
      entry.CFBundleURLSchemes.includes(DEV_PROTOCOL_SCHEME),
  );

  return (
    plist.CFBundleIdentifier === DEV_BUNDLE_IDENTIFIER &&
    plist.CFBundleName === DEV_BUNDLE_NAME &&
    plist.CFBundleDisplayName === DEV_BUNDLE_NAME &&
    plist.NSPrincipalClass === "AtomApplication" &&
    protocol?.CFBundleTypeRole === "Editor"
  );
}

function runPlistBuddy(plistPath, command, ignoreFailure = false) {
  try {
    execFileSync(PLIST_BUDDY, ["-c", command, plistPath], { stdio: "ignore" });
  } catch (error) {
    if (!ignoreFailure) throw error;
  }
}

function prepareDevProtocolMetadata(appPath) {
  const current = readInfoPlist(appPath);
  if (hasDevProtocolMetadata(current.value)) return false;

  runPlistBuddy(
    current.plistPath,
    `Set :CFBundleIdentifier "${DEV_BUNDLE_IDENTIFIER}"`,
  );
  runPlistBuddy(current.plistPath, `Set :CFBundleName "${DEV_BUNDLE_NAME}"`);
  runPlistBuddy(current.plistPath, "Delete :CFBundleDisplayName", true);
  runPlistBuddy(
    current.plistPath,
    `Add :CFBundleDisplayName string "${DEV_BUNDLE_NAME}"`,
  );
  runPlistBuddy(current.plistPath, 'Set :NSPrincipalClass "AtomApplication"');
  runPlistBuddy(current.plistPath, "Delete :CFBundleURLTypes", true);
  runPlistBuddy(current.plistPath, "Add :CFBundleURLTypes array");
  runPlistBuddy(current.plistPath, "Add :CFBundleURLTypes:0 dict");
  runPlistBuddy(
    current.plistPath,
    'Add :CFBundleURLTypes:0:CFBundleTypeRole string "Editor"',
  );
  runPlistBuddy(
    current.plistPath,
    'Add :CFBundleURLTypes:0:CFBundleURLName string "com.tomz.uichat.dev.oauth"',
  );
  runPlistBuddy(
    current.plistPath,
    "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
  );
  runPlistBuddy(
    current.plistPath,
    `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string "${DEV_PROTOCOL_SCHEME}"`,
  );

  const updated = readInfoPlist(appPath);
  if (!hasDevProtocolMetadata(updated.value)) {
    throw new Error("Failed to prepare macOS dev OAuth protocol metadata");
  }
  return true;
}

function hasValidLocalSignature(appPath) {
  try {
    runCodesign(["--verify", "--deep", "--strict", appPath], "ignore");
    return true;
  } catch {
    return false;
  }
}

function hasAdHocSignature(appPath) {
  const result = spawnSync(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", appPath],
    { encoding: "utf8" },
  );
  const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 && details.includes("Signature=adhoc");
}

function passesGatekeeperAssessment(appPath) {
  try {
    execFileSync(
      "/usr/sbin/spctl",
      ["--assess", "--type", "execute", "--verbose=4", appPath],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function registerWithLaunchServices(appPath) {
  execFileSync(LSREGISTER, ["-f", appPath], { stdio: "ignore" });
}

function prepareElectronMacosDev() {
  if (process.platform !== "darwin") {
    throw new Error("Electron macOS development preparation requires darwin");
  }

  const appPath = resolveElectronAppPath();
  if (!fs.existsSync(appPath)) {
    throw new Error(`Electron.app is missing: ${appPath}. Run pnpm install first.`);
  }

  const metadataChanged = prepareDevProtocolMetadata(appPath);
  const hasValidSignature = hasValidLocalSignature(appPath);
  if (
    metadataChanged ||
    !hasValidSignature ||
    (!hasAdHocSignature(appPath) && !passesGatekeeperAssessment(appPath))
  ) {
    // The development bundle is intentionally mutated with Mira's dev-only
    // URL-scheme identity. Re-sign after that mutation; release apps still use
    // the normal Developer ID signing/notarization path.
    console.log(`[electron:mac] Applying local ad-hoc signature: ${appPath}`);
    runCodesign([
      "--force",
      "--deep",
      "--sign",
      "-",
      "--timestamp=none",
      appPath,
    ]);
    runCodesign(["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  } else {
    console.log(`[electron:mac] Reusing prepared local signature: ${appPath}`);
  }

  // Refresh LaunchServices after Info.plist changes so the already-running
  // development app can receive mira-desktop:// callbacks through open-url.
  registerWithLaunchServices(appPath);
  console.log(
    `[electron:mac] Registered ${DEV_PROTOCOL_SCHEME} for ${DEV_BUNDLE_IDENTIFIER}`,
  );
}

prepareElectronMacosDev();
