import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_NAME = "@wnjxyk/dsh-codex-oauth";
const [state, source, requestedSpec, expectedVersion] = process.argv.slice(2);
const dshHome = process.env.DSH_HOME;

assert.ok(dshHome, "DSH_HOME must point at the isolated test home");
assert.ok(["installed", "uninstalled"].includes(state), `unknown state: ${state}`);
assert.ok(["npm", "github", "tarball"].includes(source), `unknown source: ${source}`);

const profileRoot = join(dshHome, "profiles", "web");
const profilePath = join(profileRoot, "package.json");
assert.ok(existsSync(profilePath), `DSH did not create ${profilePath}`);

const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const dependency = profile.dependencies?.[PACKAGE_NAME];
const bundles = profile.dsh?.profile?.bundles ?? [];
const installedPackagePath = join(
  profileRoot,
  "node_modules",
  "@wnjxyk",
  "dsh-codex-oauth",
  "package.json",
);

if (state === "installed") {
  assert.equal(typeof dependency, "string", `${PACKAGE_NAME} is missing from dependencies`);
  assert.ok(bundles.includes(PACKAGE_NAME), `${PACKAGE_NAME} is missing from DSH bundles`);
  assert.ok(existsSync(installedPackagePath), `${PACKAGE_NAME} is missing from node_modules`);

  if (source === "npm") {
    assert.ok(!dependency.includes("github:"), `npm install resolved to ${dependency}`);
  } else if (source === "github") {
    assert.ok(
      dependency.includes("github:") || dependency.startsWith("git+"),
      `GitHub install resolved to ${dependency}`,
    );
  } else {
    assert.match(dependency, /\.tgz(?:$|[#?])/u, `tarball install resolved to ${dependency}`);
  }

  const installedPackage = JSON.parse(readFileSync(installedPackagePath, "utf8"));
  assert.equal(installedPackage.name, PACKAGE_NAME);
  assert.match(installedPackage.version, /^\d+\.\d+\.\d+/u);
  if (expectedVersion) {
    assert.equal(installedPackage.version, expectedVersion);
  }

  const installedRoot = join(profileRoot, "node_modules", "@wnjxyk", "dsh-codex-oauth");
  const client = readFileSync(join(installedRoot, "lib", "client.js"), "utf8");
  const bundlePatch = readFileSync(join(installedRoot, "cordis.patch.yml"), "utf8");
  assert.match(client, /id:\s*["']@wnjxyk\/dsh-codex-oauth["']/u);
  assert.match(bundlePatch, /name:\s*["']@wnjxyk\/dsh-codex-oauth["']/u);

  console.log(
    `verified installed state: ${PACKAGE_NAME}@${installedPackage.version} from ${source} (${requestedSpec})`,
  );
} else {
  assert.equal(dependency, undefined, `${PACKAGE_NAME} remains in dependencies`);
  assert.ok(!bundles.includes(PACKAGE_NAME), `${PACKAGE_NAME} remains in DSH bundles`);
  assert.ok(!existsSync(installedPackagePath), `${PACKAGE_NAME} remains in node_modules`);
  console.log(`verified uninstalled state: ${PACKAGE_NAME} removed after ${source} install`);
}
