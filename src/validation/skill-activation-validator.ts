/**
 * Activation-time skill manifest validator.
 *
 * Provides:
 *   - `FIRST_PARTY_MANIFESTS` — canonical ordered registry of all first-party tool manifests.
 *   - `validateSkillManifestsForActivation` — integration point between `SkillManifestValidator`
 *     and the OpenClaw plugin lifecycle. Called inside `activate()` after the version banner and
 *     before watcher startup so that long-lived resources are never allocated against an invalid
 *     manifest set.
 *
 * Environment variables:
 *   - `OPENAUTHORITY_ALLOW_UNSAFE_LEGACY=1` — demotes all manifest validation failures from
 *     activation-aborting errors to warnings. Expressed as the `allowUnsafeLegacy` parameter so
 *     tests can control behaviour without touching `process.env`.
 *
 * New tool manifests must be added to `FIRST_PARTY_MANIFESTS` in declaration order.
 */

import { SkillManifestValidator, type ToolManifest } from './skill-manifest-validator.js';
import { gitAddManifest } from '../tools/git_add/manifest.js';
import { gitBranchManifest } from '../tools/git_branch/manifest.js';
import { gitCheckoutManifest } from '../tools/git_checkout/manifest.js';
import { gitCloneManifest } from '../tools/git_clone/manifest.js';
import { gitCommitManifest } from '../tools/git_commit/manifest.js';
import { gitDiffManifest } from '../tools/git_diff/manifest.js';
import { gitLogManifest } from '../tools/git_log/manifest.js';
import { gitMergeManifest } from '../tools/git_merge/manifest.js';
import { gitPushManifest } from '../tools/git_push/manifest.js';
import { gitResetManifest } from '../tools/git_reset/manifest.js';
import { gitStatusManifest } from '../tools/git_status/manifest.js';
import { appendFileManifest } from '../tools/append_file/manifest.js';
import { checkExistsManifest } from '../tools/check_exists/manifest.js';
import { copyFileManifest } from '../tools/copy_file/manifest.js';
import { createDirectoryManifest } from '../tools/create_directory/manifest.js';
import { deleteFileManifest } from '../tools/delete_file/manifest.js';
import { editFileManifest } from '../tools/edit_file/manifest.js';
import { findFilesManifest } from '../tools/find_files/manifest.js';
import { grepFilesManifest } from '../tools/grep_files/manifest.js';
import { listDirManifest } from '../tools/list_dir/manifest.js';
import { listDirectoryManifest } from '../tools/list_directory/manifest.js';
import { makeDirManifest } from '../tools/make_dir/manifest.js';
import { moveFileManifest } from '../tools/move_file/manifest.js';
import { readFileManifest } from '../tools/read_file/manifest.js';
import { readFilesBatchManifest } from '../tools/read_files_batch/manifest.js';
import { writeFileManifest } from '../tools/write_file/manifest.js';
import { fetchUrlManifest } from '../tools/fetch_url/manifest.js';
import { httpDeleteManifest } from '../tools/http_delete/manifest.js';
import { httpGetManifest } from '../tools/http_get/manifest.js';
import { httpPatchManifest } from '../tools/http_patch/manifest.js';
import { httpPostManifest } from '../tools/http_post/manifest.js';
import { httpPutManifest } from '../tools/http_put/manifest.js';
import { scrapePageManifest } from '../tools/scrape_page/manifest.js';
import { searchWebManifest } from '../tools/search_web/manifest.js';
import { callWebhookManifest } from '../tools/call_webhook/manifest.js';
import { sendEmailManifest } from '../tools/send_email/manifest.js';
import { sendSlackManifest } from '../tools/send_slack/manifest.js';
import { sendWebhookManifest } from '../tools/send_webhook/manifest.js';
import { webhookManifest } from '../tools/webhook/manifest.js';
import { readSecretManifest } from '../tools/read_secret/manifest.js';
import { writeSecretManifest } from '../tools/write_secret/manifest.js';
import { rotateSecretManifest } from '../tools/rotate_secret/manifest.js';
import { listSecretsManifest } from '../tools/list_secrets/manifest.js';
import { storeSecretManifest } from '../tools/store_secret/manifest.js';
import { getEnvVarManifest } from '../tools/get_env_var/manifest.js';
import { getSystemInfoManifest } from '../tools/get_system_info/manifest.js';
import { unsafeAdminExecManifest } from '../tools/unsafe_admin_exec/manifest.js';
import { npmInstallManifest } from '../tools/npm_install/manifest.js';
import { npmRunManifest } from '../tools/npm_run/manifest.js';
import { npmRunBuildManifest } from '../tools/npm_run_build/manifest.js';
import { pipInstallManifest } from '../tools/pip_install/manifest.js';
import { pipListManifest } from '../tools/pip_list/manifest.js';
import { pytestManifest } from '../tools/pytest/manifest.js';
import { dockerRunManifest } from '../tools/docker_run/manifest.js';
import { makeRunManifest } from '../tools/make_run/manifest.js';
import { runCodeManifest } from '../tools/run_code/manifest.js';
import { runLinterManifest } from '../tools/run_linter/manifest.js';
import { runTestsManifest } from '../tools/run_tests/manifest.js';
import { archiveCreateManifest } from '../tools/archive_create/manifest.js';
import { archiveExtractManifest } from '../tools/archive_extract/manifest.js';
import { archiveListManifest } from '../tools/archive_list/manifest.js';

// ─── First-party manifest registry ───────────────────────────────────────────

/**
 * Canonical ordered registry of all first-party tool manifests.
 *
 * New tool manifests must be appended here. The order is preserved for
 * deterministic validation output and error reporting.
 */
export const FIRST_PARTY_MANIFESTS: readonly ToolManifest[] = [
  // VCS tools
  gitAddManifest,
  gitBranchManifest,
  gitCheckoutManifest,
  gitCloneManifest,
  gitCommitManifest,
  gitDiffManifest,
  gitLogManifest,
  gitMergeManifest,
  gitPushManifest,
  gitResetManifest,
  gitStatusManifest,
  // Filesystem tools
  appendFileManifest,
  checkExistsManifest,
  copyFileManifest,
  createDirectoryManifest,
  deleteFileManifest,
  editFileManifest,
  findFilesManifest,
  grepFilesManifest,
  listDirManifest,
  listDirectoryManifest,
  makeDirManifest,
  moveFileManifest,
  readFileManifest,
  readFilesBatchManifest,
  writeFileManifest,
  // Web and HTTP tools
  fetchUrlManifest,
  httpDeleteManifest,
  httpGetManifest,
  httpPatchManifest,
  httpPostManifest,
  httpPutManifest,
  scrapePageManifest,
  searchWebManifest,
  // Communication tools
  callWebhookManifest,
  sendEmailManifest,
  sendSlackManifest,
  sendWebhookManifest,
  webhookManifest,
  // Credential tools
  readSecretManifest,
  writeSecretManifest,
  rotateSecretManifest,
  listSecretsManifest,
  storeSecretManifest,
  // System tools
  getEnvVarManifest,
  getSystemInfoManifest,
  unsafeAdminExecManifest,
  // Package and build tools
  npmInstallManifest,
  npmRunManifest,
  npmRunBuildManifest,
  pipInstallManifest,
  pipListManifest,
  pytestManifest,
  dockerRunManifest,
  makeRunManifest,
  runCodeManifest,
  runLinterManifest,
  runTestsManifest,
  // Archive tools
  archiveCreateManifest,
  archiveExtractManifest,
  archiveListManifest,
];

// ─── Activation validator ─────────────────────────────────────────────────────

/**
 * Validates all first-party skill manifests before plugin activation.
 *
 * Iterates `FIRST_PARTY_MANIFESTS` (or a caller-supplied override) through
 * `SkillManifestValidator` and collects all failures. When `allowUnsafeLegacy`
 * is `false` (the default), any failure throws an `Error` that aborts activation.
 * When `true`, failures are demoted to `console.warn` entries and activation
 * proceeds.
 *
 * @param allowUnsafeLegacy  When `true`, validation failures become warnings.
 *   Defaults to `process.env.OPENAUTHORITY_ALLOW_UNSAFE_LEGACY === "1"`.
 * @param manifests  Manifest list to validate. Defaults to `FIRST_PARTY_MANIFESTS`.
 *   Override in tests to inject invalid manifests without mutating the registry.
 * @throws {Error} When any manifest fails validation and `allowUnsafeLegacy` is `false`.
 */
export function validateSkillManifestsForActivation(
  allowUnsafeLegacy = process.env['OPENAUTHORITY_ALLOW_UNSAFE_LEGACY'] === '1',
  manifests: readonly ToolManifest[] = FIRST_PARTY_MANIFESTS,
): void {
  const validator = new SkillManifestValidator();
  const failures: string[] = [];

  for (const manifest of manifests) {
    const result = validator.validate(manifest);
    if (!result.valid) {
      const msg = `"${manifest.name}": ${result.errors.join('; ')}`;
      if (allowUnsafeLegacy) {
        console.warn(`[OpenAuthority] Manifest validation warning: ${msg}`);
      } else {
        failures.push(msg);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[OpenAuthority] Skill manifest validation failed — activation aborted:\n` +
        failures.map((f) => `  • ${f}`).join('\n'),
    );
  }
}
