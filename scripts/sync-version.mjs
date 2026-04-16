#!/usr/bin/env node
// Generate openclaw.plugin.json from openclaw.plugin.template.json,
// injecting `version` from package.json.
//
// package.json is the single source of truth for the version string.
// openclaw.plugin.json is a build artifact (gitignored) and must be
// regenerated before build, pack, or publish. Wired as `prebuild` and
// `prepare` in package.json so it runs automatically in every relevant
// lifecycle.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const templatePath = resolve(root, "openclaw.plugin.template.json");
const manifestPath = resolve(root, "openclaw.plugin.json");

const template = JSON.parse(readFileSync(templatePath, "utf8"));

// Insert `version` right after `displayName` so the key order reads naturally.
const manifest = {};
for (const [key, value] of Object.entries(template)) {
  manifest[key] = value;
  if (key === "displayName") {
    manifest.version = pkg.version;
  }
}
// Fallback: if the template lacks `displayName`, stick version at the front.
if (!("version" in manifest)) {
  manifest.version = pkg.version;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`[sync-version] openclaw.plugin.json generated at v${pkg.version}`);
