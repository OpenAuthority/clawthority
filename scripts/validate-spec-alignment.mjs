/**
 * Spec alignment CI validation script.
 *
 * Runs the SpecAlignmentValidator against the project root and prints a
 * compliance report to stdout. Exits with code 1 when any check fails.
 *
 * Usage:
 *   node scripts/validate-spec-alignment.mjs
 *
 * Requires the TypeScript sources to be compiled first:
 *   npm run build && node scripts/validate-spec-alignment.mjs
 *
 * Or use the package.json convenience script:
 *   npm run validate:spec
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const distPath = join(projectRoot, 'dist', 'validation', 'spec-alignment-validator.js');

// Verify compiled output exists before attempting dynamic import
if (!existsSync(distPath)) {
  console.error(
    '[validate-spec-alignment] Error: compiled output not found at dist/validation/spec-alignment-validator.js',
  );
  console.error('[validate-spec-alignment] Run `npm run build` first.');
  process.exit(1);
}

const { SpecAlignmentValidator } = await import(distPath);

const validator = new SpecAlignmentValidator();
const result = validator.validate({ root: projectRoot });
const report = validator.generateReport(result);

console.log(report);

if (!result.compliant) {
  process.exit(1);
}
