# examples/skills

Reference SKILL.md manifests used by the Clawthority CI validators
(`scripts/validate-skill-manifests.mjs`, `src/validation/no-exec-regression.test.ts`)
and by the UI widget that surfaces `unsafe_legacy` exemptions.

**These are sample manifests, not plugin functionality.** They demonstrate the
shape Clawthority expects for `action_class`, `unsafe_legacy`, and related
frontmatter fields. They are intentionally not shipped in the published npm
package (see the `files` field in [../../package.json](../../package.json)).

If you are installing Clawthority, you can ignore this directory entirely.
