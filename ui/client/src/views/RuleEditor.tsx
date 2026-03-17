import { useState, useCallback } from "react";
import { rulesApi, ApiError } from "../api";
import type { Rule as ApiRule, RuleInput } from "../api";
import "./RuleEditor.css";

// ─── Types (mirrored from src/policy/types.ts) ───────────────────────────────

type Effect = "permit" | "forbid";
type Resource = "tool" | "command" | "channel" | "prompt";

interface RateLimit {
  maxCalls: number;
  windowSeconds: number;
}

// ─── Internal form state ──────────────────────────────────────────────────────

interface FormState {
  effect: Effect;
  resource: Resource;
  match: string;
  matchIsRegex: boolean;
  conditionBody: string;
  reason: string;
  tags: string; // comma-separated
  rateLimitEnabled: boolean;
  rateLimitMaxCalls: string;
  rateLimitWindowSeconds: string;
}

interface FormErrors {
  match?: string;
  conditionBody?: string;
  rateLimitMaxCalls?: string;
  rateLimitWindowSeconds?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RuleEditorProps {
  /** ID of the rule being edited. If set, PUT is used; otherwise POST. */
  ruleId?: string;
  /** Pre-populate form fields when editing an existing rule. */
  initialRule?: Partial<ApiRule>;
  /** Called with the saved rule after a successful API response. */
  onSave: (rule: ApiRule) => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ruleToFormState(rule?: Partial<ApiRule>): FormState {
  if (!rule) {
    return {
      effect: "permit",
      resource: "tool",
      match: "",
      matchIsRegex: false,
      conditionBody: "",
      reason: "",
      tags: "",
      rateLimitEnabled: false,
      rateLimitMaxCalls: "10",
      rateLimitWindowSeconds: "60",
    };
  }

  return {
    effect: rule.effect ?? "permit",
    resource: rule.resource ?? "tool",
    match: rule.match ?? "",
    matchIsRegex: false, // API always stores match as a plain string
    conditionBody: rule.condition ?? "",
    reason: rule.reason ?? "",
    tags: rule.tags?.join(", ") ?? "",
    rateLimitEnabled: !!rule.rateLimit,
    rateLimitMaxCalls: String(rule.rateLimit?.maxCalls ?? 10),
    rateLimitWindowSeconds: String(rule.rateLimit?.windowSeconds ?? 60),
  };
}

// ─── Live preview sub-component ───────────────────────────────────────────────

function RulePreview({ form }: { form: FormState }) {
  const matchDisplay = form.match.trim()
    ? form.matchIsRegex
      ? `/${form.match}/`
      : `"${form.match}"`
    : "<not set>";

  const tags = form.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const isPermit = form.effect === "permit";

  return (
    <div className="rule-preview">
      <div className="rule-preview__header">
        <span
          className={`rule-preview__badge ${
            isPermit
              ? "rule-preview__badge--permit"
              : "rule-preview__badge--forbid"
          }`}
        >
          {form.effect.toUpperCase()}
        </span>
        <span className="rule-preview__resource">{form.resource}</span>
      </div>

      <div className="rule-preview__body">
        <div className="rule-preview__row">
          <span className="rule-preview__key">Match</span>
          <code className="rule-preview__value rule-preview__value--code">
            {matchDisplay}
          </code>
        </div>

        {form.conditionBody.trim() && (
          <div className="rule-preview__row">
            <span className="rule-preview__key">Condition</span>
            <pre className="rule-preview__value rule-preview__value--pre">
              {`function(context) {\n${form.conditionBody}\n}`}
            </pre>
          </div>
        )}

        {form.reason.trim() && (
          <div className="rule-preview__row">
            <span className="rule-preview__key">Reason</span>
            <span className="rule-preview__value">{form.reason}</span>
          </div>
        )}

        {tags.length > 0 && (
          <div className="rule-preview__row">
            <span className="rule-preview__key">Tags</span>
            <div className="rule-preview__tags">
              {tags.map((tag) => (
                <span key={tag} className="rule-preview__tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {form.rateLimitEnabled && (
          <div className="rule-preview__row">
            <span className="rule-preview__key">Rate limit</span>
            <span className="rule-preview__value">
              {form.rateLimitMaxCalls || "?"} calls /{" "}
              {form.rateLimitWindowSeconds || "?"}s
            </span>
          </div>
        )}

        <div className="rule-preview__semantics">
          <span className="rule-preview__semantics-label">
            Evaluation semantics
          </span>
          <span className="rule-preview__semantics-desc">
            {isPermit
              ? "Permits access when matched, unless overridden by a forbid rule."
              : "Denies access when matched. Forbid takes priority over permit."}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── RuleEditor ───────────────────────────────────────────────────────────────

export function RuleEditor({ ruleId, initialRule, onSave, onCancel }: RuleEditorProps) {
  const [form, setForm] = useState<FormState>(() =>
    ruleToFormState(initialRule)
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    []
  );

  const validate = useCallback((): boolean => {
    const next: FormErrors = {};

    if (!form.match.trim()) {
      next.match = "Match pattern is required.";
    } else if (form.matchIsRegex) {
      try {
        new RegExp(form.match);
      } catch {
        next.match = "Invalid regular expression.";
      }
    }

    if (form.conditionBody.trim()) {
      // Basic client-side syntax heuristics — full validation happens server-side.
      const body = form.conditionBody.trim();
      const openBraces = (body.match(/{/g) || []).length;
      const closeBraces = (body.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        next.conditionBody = "Mismatched braces in condition body.";
      }
    }

    if (form.rateLimitEnabled) {
      const maxCalls = Number(form.rateLimitMaxCalls);
      if (!Number.isInteger(maxCalls) || maxCalls <= 0) {
        next.rateLimitMaxCalls = "Must be a positive integer.";
      }
      const windowSecs = Number(form.rateLimitWindowSeconds);
      if (!Number.isInteger(windowSecs) || windowSecs <= 0) {
        next.rateLimitWindowSeconds = "Must be a positive integer (seconds).";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;

    const data: RuleInput = {
      effect: form.effect,
      resource: form.resource,
      match: form.match.trim(),
    };

    if (form.conditionBody.trim()) {
      data.condition = form.conditionBody.trim();
    }

    if (form.reason.trim()) {
      data.reason = form.reason.trim();
    }

    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 0) {
      data.tags = tags;
    }

    if (form.rateLimitEnabled) {
      const rl: RateLimit = {
        maxCalls: Number(form.rateLimitMaxCalls),
        windowSeconds: Number(form.rateLimitWindowSeconds),
      };
      data.rateLimit = rl;
    }

    setSaving(true);
    setApiError(null);
    try {
      const saved = ruleId
        ? await rulesApi.update(ruleId, data)
        : await rulesApi.create(data);
      onSave(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        setApiError(err.fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; "));
      } else {
        setApiError(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    } finally {
      setSaving(false);
    }
  }, [form, validate, onSave, ruleId]);

  const isEditing = !!ruleId;

  return (
    <div className="rule-editor">
      <div className="rule-editor__layout">
        {/* ── Form ── */}
        <div className="rule-editor__form">
          <h2 className="rule-editor__title">
            {isEditing ? "Edit Rule" : "New Rule"}
          </h2>

          {apiError && (
            <div className="rule-editor__api-error">{apiError}</div>
          )}

          {/* Effect + Resource */}
          <div className="rule-editor__section">
            <div className="rule-editor__row">
              <label className="rule-editor__label" htmlFor="re-effect">
                Effect
              </label>
              <select
                id="re-effect"
                className="rule-editor__select"
                value={form.effect}
                onChange={(e) => update("effect", e.target.value as Effect)}
              >
                <option value="permit">Permit</option>
                <option value="forbid">Forbid</option>
              </select>
            </div>

            <div className="rule-editor__row">
              <label className="rule-editor__label" htmlFor="re-resource">
                Resource type
              </label>
              <select
                id="re-resource"
                className="rule-editor__select"
                value={form.resource}
                onChange={(e) =>
                  update("resource", e.target.value as Resource)
                }
              >
                <option value="tool">Tool</option>
                <option value="command">Command</option>
                <option value="channel">Channel</option>
                <option value="prompt">Prompt</option>
              </select>
            </div>
          </div>

          {/* Match */}
          <div className="rule-editor__section">
            <div className="rule-editor__row">
              <div className="rule-editor__label-row">
                <label className="rule-editor__label" htmlFor="re-match">
                  Match pattern
                </label>
                <label className="rule-editor__toggle">
                  <input
                    type="checkbox"
                    checked={form.matchIsRegex}
                    onChange={(e) => update("matchIsRegex", e.target.checked)}
                  />
                  <span>Regex</span>
                </label>
              </div>
              <input
                id="re-match"
                type="text"
                className={`rule-editor__input${errors.match ? " rule-editor__input--error" : ""}`}
                placeholder={form.matchIsRegex ? "^tool-name.*" : "tool-name"}
                value={form.match}
                onChange={(e) => update("match", e.target.value)}
              />
              {errors.match && (
                <span className="rule-editor__error">{errors.match}</span>
              )}
              <span className="rule-editor__hint">
                {form.matchIsRegex
                  ? "Regular expression tested against the resource identifier."
                  : "Exact string matched against the resource identifier."}
              </span>
            </div>
          </div>

          {/* Condition */}
          <div className="rule-editor__section">
            <div className="rule-editor__row">
              <label className="rule-editor__label" htmlFor="re-condition">
                Condition{" "}
                <span className="rule-editor__optional">(optional)</span>
              </label>
              <div className="rule-editor__code-wrap">
                <span className="rule-editor__code-prefix">
                  {"function(context) {"}
                </span>
                <textarea
                  id="re-condition"
                  className={`rule-editor__textarea${errors.conditionBody ? " rule-editor__textarea--error" : ""}`}
                  placeholder={
                    "  // return true to apply the effect\n  return context.agentId === 'my-agent';"
                  }
                  value={form.conditionBody}
                  onChange={(e) => update("conditionBody", e.target.value)}
                  rows={5}
                  spellCheck={false}
                />
                <span className="rule-editor__code-suffix">{"}"}</span>
              </div>
              {errors.conditionBody && (
                <span className="rule-editor__error">
                  {errors.conditionBody}
                </span>
              )}
              <span className="rule-editor__hint">
                JavaScript function body. Available via{" "}
                <code>context</code>:{" "}
                <code>agentId</code>, <code>channel</code>,{" "}
                <code>userId</code>, <code>sessionId</code>,{" "}
                <code>metadata</code>.
              </span>
            </div>
          </div>

          {/* Reason + Tags */}
          <div className="rule-editor__section">
            <div className="rule-editor__row">
              <label className="rule-editor__label" htmlFor="re-reason">
                Reason{" "}
                <span className="rule-editor__optional">(optional)</span>
              </label>
              <input
                id="re-reason"
                type="text"
                className="rule-editor__input"
                placeholder="Describe why this rule exists"
                value={form.reason}
                onChange={(e) => update("reason", e.target.value)}
              />
            </div>

            <div className="rule-editor__row">
              <label className="rule-editor__label" htmlFor="re-tags">
                Tags{" "}
                <span className="rule-editor__optional">(optional)</span>
              </label>
              <input
                id="re-tags"
                type="text"
                className="rule-editor__input"
                placeholder="e.g. security, production, internal"
                value={form.tags}
                onChange={(e) => update("tags", e.target.value)}
              />
              <span className="rule-editor__hint">Comma-separated list.</span>
            </div>
          </div>

          {/* Rate limiting */}
          <div className="rule-editor__section">
            <div className="rule-editor__row">
              <label className="rule-editor__label rule-editor__label--inline">
                <input
                  type="checkbox"
                  checked={form.rateLimitEnabled}
                  onChange={(e) =>
                    update("rateLimitEnabled", e.target.checked)
                  }
                />
                Enable rate limiting
              </label>
            </div>

            <span className="rule-editor__hint">
              Restrict how many times this resource can be invoked within a
              rolling time window. Requests beyond the limit are denied even if
              the rule would otherwise permit them.
            </span>

            {form.rateLimitEnabled && (
              <div className="rule-editor__rate-limit">
                <div className="rule-editor__row">
                  <label
                    className="rule-editor__label"
                    htmlFor="re-max-calls"
                  >
                    Max calls
                  </label>
                  <input
                    id="re-max-calls"
                    type="number"
                    min="1"
                    className={`rule-editor__input rule-editor__input--sm${errors.rateLimitMaxCalls ? " rule-editor__input--error" : ""}`}
                    value={form.rateLimitMaxCalls}
                    onChange={(e) =>
                      update("rateLimitMaxCalls", e.target.value)
                    }
                  />
                  {errors.rateLimitMaxCalls && (
                    <span className="rule-editor__error">
                      {errors.rateLimitMaxCalls}
                    </span>
                  )}
                </div>

                <div className="rule-editor__row">
                  <label
                    className="rule-editor__label"
                    htmlFor="re-window-secs"
                  >
                    Window (seconds)
                  </label>
                  <input
                    id="re-window-secs"
                    type="number"
                    min="1"
                    className={`rule-editor__input rule-editor__input--sm${errors.rateLimitWindowSeconds ? " rule-editor__input--error" : ""}`}
                    value={form.rateLimitWindowSeconds}
                    onChange={(e) =>
                      update("rateLimitWindowSeconds", e.target.value)
                    }
                  />
                  {errors.rateLimitWindowSeconds && (
                    <span className="rule-editor__error">
                      {errors.rateLimitWindowSeconds}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="rule-editor__actions">
            <button
              type="button"
              className="rule-editor__btn rule-editor__btn--cancel"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rule-editor__btn rule-editor__btn--save"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create rule"}
            </button>
          </div>
        </div>

        {/* ── Live Preview ── */}
        <div className="rule-editor__preview-panel">
          <h3 className="rule-editor__preview-heading">Live preview</h3>
          <RulePreview form={form} />
        </div>
      </div>
    </div>
  );
}
