import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAppMetaJsons } from "../scripts/app-meta-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const outputDir = path.join(projectRoot, ".artifacts", "server-bundle");
const outputNodeModules = path.join(outputDir, "node_modules");
const pnpmStore = path.join(projectRoot, "node_modules", ".pnpm");
const pnpmVirtualNodeModules = path.join(pnpmStore, "node_modules");
const targetPlatform = process.platform;
const targetArch = process.arch;
const nodePtyPrebuildName = `${targetPlatform}-${targetArch}`;
const sharpPlatformPackage = `@img/sharp-${targetPlatform}-${targetArch}`;
const sharpLibvipsPackage = `@img/sharp-libvips-${targetPlatform}-${targetArch}`;
const sqliteVecPlatformPackage = `sqlite-vec-${targetPlatform}-${targetArch}`;

function readPackageJson(packageDir) {
  return JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"),
  );
}

function writeAppMetaJson() {
  writeAppMetaJsons(projectRoot, [path.join(outputDir, "app-meta.json")]);
}

function copyToolsDir() {
  const toolsSource = path.join(__dirname, "tools");
  const toolsDest = path.join(outputDir, "tools");

  if (!fs.existsSync(toolsSource)) {
    return;
  }

  fs.cpSync(toolsSource, toolsDest, { recursive: true, dereference: true });
  console.log(`Copied built-in tools: ${toolsDest}`);
}

function copySkillsDir() {
  const skillsSource = path.join(__dirname, "src", "skills");
  const skillsDest = path.join(outputDir, "skills");

  if (!fs.existsSync(skillsSource)) {
    return;
  }

  fs.cpSync(skillsSource, skillsDest, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      if (fs.statSync(source).isDirectory()) return true;
      const extension = path.extname(source).toLowerCase();
      return [".md", ".txt", ".json", ".yaml", ".yml"].includes(extension);
    },
  });
  console.log(`Copied built-in Skill resources: ${skillsDest}`);
}

function copyStaticDir() {
  const staticSource = path.join(__dirname, "static");
  const staticDest = path.join(outputDir, "static");
  const swaggerUiPackageSource = resolveInstalledPackageSource("@fastify/swagger-ui");
  const brandingLogoSource = path.join(
    projectRoot,
    "desktop",
    "src",
    "assets",
    "branding",
    "uichat-logo-icon.png",
  );

  if (!fs.existsSync(staticSource)) {
    fs.mkdirSync(staticDest, { recursive: true });
  } else {
    fs.cpSync(staticSource, staticDest, { recursive: true, dereference: true });
  }

  if (!fs.existsSync(brandingLogoSource)) {
    throw new Error(`Missing branding logo: ${brandingLogoSource}`);
  }

  if (!swaggerUiPackageSource) {
    throw new Error("Cannot find installed package for @fastify/swagger-ui");
  }

  const swaggerUiLogoSource = path.join(swaggerUiPackageSource, "logo.svg");
  if (!fs.existsSync(swaggerUiLogoSource)) {
    throw new Error(`Missing Swagger UI logo: ${swaggerUiLogoSource}`);
  }

  fs.copyFileSync(brandingLogoSource, path.join(staticDest, "logo.png"));
  fs.copyFileSync(swaggerUiLogoSource, path.join(staticDest, "logo.svg"));
  console.log(`Copied static assets: ${staticDest}`);
}

function resolveInstalledPackageSource(packageName) {
  const virtualPackageJson = path.join(
    pnpmVirtualNodeModules,
    packageName,
    "package.json",
  );
  if (fs.existsSync(virtualPackageJson)) {
    return path.dirname(fs.realpathSync(virtualPackageJson));
  }

  const packageDirName = fs
    .readdirSync(pnpmStore)
    .find((name) => name.startsWith(`${packageName}@`));

  if (!packageDirName) {
    return null;
  }

  return path.join(pnpmStore, packageDirName, "node_modules", packageName);
}

function copyPackage(packageName) {
  const serverPackage = readPackageJson(__dirname);
  const version = serverPackage.dependencies?.[packageName];
  const source = resolveInstalledPackageSource(packageName);

  if (!source) {
    const suffix = version ? `@${version}` : "";
    throw new Error(`Cannot find installed pnpm package for ${packageName}${suffix}`);
  }
  const destination = path.join(outputNodeModules, packageName);

  if (!fs.existsSync(source)) {
    throw new Error(`Cannot find package ${packageName} at ${source}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  console.log(`Copied native package ${packageName}`);
}

function copyPackageTree(packageName, copied = new Set()) {
  if (copied.has(packageName)) {
    return;
  }

  copied.add(packageName);
  const source = resolveInstalledPackageSource(packageName);
  if (!source) {
    throw new Error(`Cannot find installed package ${packageName}`);
  }

  copyPackage(packageName);
  const packageJson = readPackageJson(source);
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyPackageTree(dependencyName, copied);
  }
}

function pruneNodePtyRuntime() {
  const packageRoot = path.join(outputNodeModules, "node-pty");
  const prebuildsRoot = path.join(packageRoot, "prebuilds");
  for (const entry of fs.readdirSync(prebuildsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== nodePtyPrebuildName) {
      fs.rmSync(path.join(prebuildsRoot, entry.name), { recursive: true, force: true });
    }
  }

  for (const directory of ["deps", "scripts", "src", "third_party", "typings"]) {
    fs.rmSync(path.join(packageRoot, directory), { recursive: true, force: true });
  }

  for (const entry of fs.readdirSync(path.join(prebuildsRoot, nodePtyPrebuildName))) {
    if (entry.endsWith(".pdb")) {
      fs.rmSync(path.join(prebuildsRoot, nodePtyPrebuildName, entry), { force: true });
    }
  }
  console.log(`Pruned node-pty to the ${nodePtyPrebuildName} runtime files`);
}

function writeBackendPackageJson() {
  const serverPackage = readPackageJson(__dirname);
  const sqliteVecPackageSource = resolveInstalledPackageSource("sqlite-vec");
  const sqliteVecPackage = sqliteVecPackageSource
    ? JSON.parse(
        fs.readFileSync(
          path.join(sqliteVecPackageSource, "package.json"),
          "utf-8",
        ),
      )
    : null;

  const backendPackage = {
    private: true,
    type: "commonjs",
    dependencies: {
      "better-sqlite3": serverPackage.dependencies["better-sqlite3"],
      jsdom: serverPackage.dependencies.jsdom,
      "playwright-core": serverPackage.dependencies["playwright-core"],
      sharp: serverPackage.dependencies.sharp,
      "sqlite-vec": serverPackage.dependencies["sqlite-vec"],
      "node-pty": serverPackage.dependencies["node-pty"],
      bindings: "^1.5.0",
      "file-uri-to-path": "^1.0.0",
      ...(sqliteVecPackage?.optionalDependencies ?? {}),
    },
  };

  fs.writeFileSync(
    path.join(outputDir, "package.json"),
    `${JSON.stringify(backendPackage, null, 2)}\n`,
  );
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(outputNodeModules, { recursive: true });
writeBackendPackageJson();
writeAppMetaJson();
copyToolsDir();
copySkillsDir();
copyStaticDir();

build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(outputDir, "server.cjs"),
  absWorkingDir: __dirname,
  external: [
    "better-sqlite3",
    "jsdom",
    "playwright-core",
    "sharp",
    "sqlite-vec",
    "node-pty",
  ],
})
  .then(() => {
    console.log("Server bundle completed, copying native modules...");
    copyPackage("better-sqlite3");
    copyPackageTree("jsdom");
    copyPackage("playwright-core");
    copyPackage("sharp");
    copyPackage("detect-libc");
    copyPackage("semver");
    copyPackage("@img/colour");
    copyPackage(sharpPlatformPackage);
    if (targetPlatform === "darwin" || targetPlatform === "linux") {
      copyPackage(sharpLibvipsPackage);
    }
    copyPackage("sqlite-vec");
    copyPackage(sqliteVecPlatformPackage);
    copyPackageTree("node-pty");
    pruneNodePtyRuntime();
    copyPackage("bindings");
    copyPackage("file-uri-to-path");
    execFileSync(process.execPath, ["-e", "require('node-pty')"], {
      cwd: outputDir,
      stdio: "inherit",
    });
    console.log("Verified staged node-pty can load with the build Node runtime");
    console.log("Server build completed successfully");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
