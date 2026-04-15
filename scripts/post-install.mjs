#!/usr/bin/env node
// Writes data/.installed to signal that plugin install has completed.
// Run this at the end of the install/bootstrap process; its presence gates
// policy activation in src/index.ts (see isInstalled()).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const markerPath = resolve(dataDir, ".installed");

mkdirSync(dataDir, { recursive: true });
writeFileSync(markerPath, new Date().toISOString() + "\n");
console.log("[openauthority] install complete — data/.installed written");
