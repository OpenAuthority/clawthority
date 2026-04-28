#!/usr/bin/env node
// Writes data/.installed to signal that plugin install has completed.
// Run this at the end of the install/bootstrap process; its presence gates
// policy activation in src/index.ts (see isInstalled()).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Preset: CLOSED+HITL (recommended security configuration)
// ---------------------------------------------------------------------------
// rules.json for the CLOSED+HITL preset — one explicit forbid that documents
// the HITL routing intent. CLOSED mode baseline provides all other permit rules.
const CLOSED_HITL_RULES = [
  {
    effect: "forbid",
    action_class: "unknown_sensitive_action",
    priority: 90,
    reason:
      "CLOSED+HITL preset: unrecognised action classes are withheld pending human review. " +
      "Configure hitl-policy.yaml and set your channel credentials to enable real-time " +
      "operator approval. To permit a specific action class without HITL, add an explicit " +
      "permit rule at a priority lower than 90.",
    tags: ["security", "hitl", "preset", "closed-hitl"],
  },
];

const CLOSED_HITL_POLICY = `version: "1"

# CLOSED+HITL preset — recommended security configuration
# =========================================================
# This preset enforces CLOSED mode with human-in-the-loop approval for any
# action whose class is not explicitly recognised. An operator reviews each
# request in real time and can Approve (once), Approve Always, or Deny.
#
# ACTIVATION
# ----------
# 1. Copy this file to hitl-policy.yaml in the plugin root:
#      cp data/presets/closed-hitl/hitl-policy.yaml hitl-policy.yaml
#
# 2. Copy the preset rules to data/rules.json (fresh install only):
#      cp data/presets/closed-hitl/rules.json data/rules.json
#
# 3. Set the mode environment variable before launching the agent:
#      export CLAWTHORITY_MODE=closed
#
# 4. Fill in your approval channel credentials below (or via env vars).
#    Environment variables always take precedence over values in this file.
#
# CREDENTIALS
# -----------
# Telegram (recommended for individuals):
#   env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# Slack (recommended for teams):
#   env: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_SIGNING_SECRET

# telegram:
#   botToken: ""   # or: TELEGRAM_BOT_TOKEN env var
#   chatId: ""     # or: TELEGRAM_CHAT_ID env var

# slack:
#   botToken: ""        # or: SLACK_BOT_TOKEN env var
#   channelId: ""       # or: SLACK_CHANNEL_ID env var
#   signingSecret: ""   # or: SLACK_SIGNING_SECRET env var
#   interactionPort: 3201

policies:
  # Gate every unrecognised action through the approval channel.
  # This policy works in tandem with the unknown_sensitive_action forbid rule
  # in rules.json: the rule prevents the action from proceeding automatically,
  # and this policy provides the operator with an Approve/Deny path.
  - name: unknown-sensitive-action-hitl
    description: >
      CLOSED+HITL preset: any action whose class is not explicitly recognised
      is routed to an operator for real-time approval. The operator can
      Approve (allow once), Approve Always (create an auto-permit), or Deny.
    actions:
      - unknown_sensitive_action
    approval:
      channel: telegram    # replace with: slack, console (for dev/testing)
      timeout: 300         # 5 minutes — operator must respond within this window
      fallback: deny       # deny automatically if the operator does not respond (fail-closed)
    tags:
      - security
      - hitl
      - preset
      - closed-hitl
`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const markerPath = resolve(dataDir, ".installed");
const rulesPath = resolve(dataDir, "rules.json");
const hitlExamplePath = resolve(dataDir, "hitl-policy.yaml.example");
const presetDir = resolve(dataDir, "presets", "closed-hitl");
const presetRulesPath = resolve(presetDir, "rules.json");
const presetPolicyPath = resolve(presetDir, "hitl-policy.yaml");

mkdirSync(dataDir, { recursive: true });
writeFileSync(markerPath, new Date().toISOString() + "\n");
console.log("[clawthority] install complete — data/.installed written");

// Secure-by-default: create starter rules.json only on fresh installs.
// Existing files are never overwritten to avoid breaking upgrades.
if (!existsSync(rulesPath)) {
  const starterRules = [
    {
      effect: "forbid",
      action_class: "unknown_sensitive_action",
      priority: 90,
      reason:
        "Actions whose class is not explicitly recognised are withheld pending human approval. " +
        "Configure a HITL policy (hitl-policy.yaml) so an operator can approve or deny each " +
        "request in real time. To permit a specific action class without HITL, add an explicit " +
        "permit rule at a priority lower than 90.",
      tags: ["security", "hitl", "default"],
    },
  ];
  writeFileSync(rulesPath, JSON.stringify(starterRules, null, 2) + "\n");
  console.log(
    "[clawthority] created data/rules.json with secure-by-default configuration"
  );
  console.log(
    "[clawthority]   → unknown_sensitive_action is forbidden at priority 90 until a human approves it"
  );
  console.log(
    "[clawthority]   → add explicit permit rules or configure hitl-policy.yaml to open access"
  );
} else {
  console.log(
    "[clawthority] data/rules.json already exists — skipping (upgrade safe)"
  );
}

// Create a baseline HITL policy example to guide operators.
// Also only written on fresh installs; existing files are left untouched.
const hitlExampleContent = `version: "1"

# Copy this file to hitl-policy.yaml and fill in your credentials.
# Environment variables (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
# SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_SIGNING_SECRET) always
# take precedence over values set directly here.

# telegram:
#   botToken: ""
#   chatId: ""

# slack:
#   botToken: ""
#   channelId: ""
#   signingSecret: ""
#   interactionPort: 3201

policies:
  # Gate every unrecognised or sensitive action through Telegram.
  # This policy mirrors the unknown_sensitive_action forbid rule in
  # rules.json: a human must approve before the action proceeds.
  - name: Unknown sensitive actions
    description: >
      Any action whose class is not explicitly permitted falls through to
      this policy. An operator reviews and approves or denies in real time.
    actions:
      - unknown_sensitive_action
    approval:
      channel: telegram
      timeout: 300   # 5 minutes — operator must respond within this window
      fallback: deny # deny if no response (fail-closed)
    tags:
      - security
      - default
`;

if (!existsSync(hitlExamplePath)) {
  writeFileSync(hitlExamplePath, hitlExampleContent);
  console.log(
    "[clawthority] created data/hitl-policy.yaml.example — copy to hitl-policy.yaml and configure credentials"
  );
} else {
  console.log(
    "[clawthority] data/hitl-policy.yaml.example already exists — skipping (upgrade safe)"
  );
}

// Write the CLOSED+HITL bootstrap preset files.
// These are always (re)written — they are read-only reference files, not
// operator-editable config, so overwriting them on upgrade is correct.
mkdirSync(presetDir, { recursive: true });
writeFileSync(presetRulesPath, JSON.stringify(CLOSED_HITL_RULES, null, 2) + "\n");
writeFileSync(presetPolicyPath, CLOSED_HITL_POLICY);
console.log(
  "[clawthority] wrote data/presets/closed-hitl/ — CLOSED+HITL bootstrap preset"
);

// Print the recommended security configuration prominently.
console.log("");
console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│  Recommended: CLOSED+HITL security preset                       │");
console.log("│                                                                  │");
console.log("│  Enforce CLOSED mode with human-in-the-loop approval for every  │");
console.log("│  unrecognised action. This is the strictest out-of-the-box       │");
console.log("│  configuration and is recommended for production deployments.    │");
console.log("│                                                                  │");
console.log("│  To activate:                                                    │");
console.log("│    cp data/presets/closed-hitl/rules.json data/rules.json       │");
console.log("│    cp data/presets/closed-hitl/hitl-policy.yaml hitl-policy.yaml│");
console.log("│    export CLAWTHORITY_MODE=closed                               │");
console.log("│                                                                  │");
console.log("│  Then edit hitl-policy.yaml and add your Telegram or Slack      │");
console.log("│  credentials. See docs/installation.md for full setup steps.    │");
console.log("└─────────────────────────────────────────────────────────────────┘");
console.log("");
