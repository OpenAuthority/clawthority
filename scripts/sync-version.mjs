#!/usr/bin/env node
// Sync version from package.json → openclaw.plugin.json.
// Single source of truth: package.json. Run automatically as prebuild.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifestPath = resolve(root, "openclaw.plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version === pkg.version) {
  console.log(`[sync-version] openclaw.plugin.json already at ${pkg.version}`);
  process.exit(0);
}

const before = manifest.version;
manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`[sync-version] openclaw.plugin.json: ${before} → ${pkg.version}`);
