# API Reference

> **Status: Reference spec — not yet implemented.**
>
> This document describes the target REST + Server-Sent Events surface for a
> Clawthority management API. **No HTTP server currently ships with the plugin.**
> The endpoints below are the agreed contract for upcoming dashboard and
> control-plane work (see [roadmap.md](roadmap.md) — *Firma Remote Adapter* and
> the *Control Plane API* under Future). Until that work lands, treat this page
> as a design document, not operational documentation.

The UI dashboard will expose a REST API for managing rules and querying the audit log, plus a Server-Sent Events (SSE) endpoint for live audit streaming.

Base URL: `http://localhost:7331` (configurable via `PORT` env var)

---

## Health

### GET /api/health

Returns the server status.

**Response**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | Always `"ok"` when the server is running |
| `timestamp` | `string` | ISO 8601 timestamp of the response |

---

## Rules

### GET /api/rules

Returns the current list of rules, optionally filtered.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `effect` | `"permit"` \| `"forbid"` | Filter by rule effect |
| `resource` | `"tool"` \| `"command"` \| `"channel"` \| `"prompt"` \| `"model"` | Filter by resource type |
| `tags` | `string` | Comma-separated tag values; rules matching any tag are included |

**Response** `200 OK`

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "effect": "permit",
    "resource": "tool",
    "match": "read_file",
    "reason": "Allow reading files",
    "tags": ["read-only"],
    "rateLimit": null
  }
]
```

Each object is a `Rule` with the following fields:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID assigned by the server |
| `effect` | `"permit"` \| `"forbid"` | Rule effect |
| `resource` | `string` | Resource type |
| `match` | `string` | Match pattern |
| `condition` | `string` \| `null` | Serialized condition function body |
| `reason` | `string` \| `null` | Human-readable rationale |
| `tags` | `string[]` | Category labels |
| `rateLimit` | `{ maxCalls: number, windowSeconds: number }` \| `null` | Rate limit config |

---

### POST /api/rules

Creates a new rule.

**Request body**

```json
{
  "effect": "permit",
  "resource": "tool",
  "match": "write_file",
  "reason": "Allow writes on trusted channels",
  "tags": ["write"],
  "rateLimit": {
    "maxCalls": 20,
    "windowSeconds": 60
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `effect` | `"permit"` \| `"forbid"` | Yes | Rule effect |
| `resource` | `"tool"` \| `"command"` \| `"channel"` \| `"prompt"` \| `"model"` | Yes | Resource type |
| `match` | `string` | Yes | Non-empty match pattern |
| `condition` | `string` | No | Serialized function body |
| `reason` | `string` | No | Description |
| `tags` | `string[]` | No | Category labels |
| `rateLimit.maxCalls` | `integer` | Required if rateLimit present | Must be ≥ 1 |
| `rateLimit.windowSeconds` | `integer` | Required if rateLimit present | Must be ≥ 1 |

**Response** `201 Created`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "effect": "permit",
  "resource": "tool",
  "match": "write_file",
  "reason": "Allow writes on trusted channels",
  "tags": ["write"],
  "rateLimit": {
    "maxCalls": 20,
    "windowSeconds": 60
  }
}
```

**Error response** `400 Bad Request`

```json
{
  "error": "Validation failed",
  "fieldErrors": [
    { "field": "effect", "message": "effect must be 'permit' or 'forbid'" }
  ]
}
```

---

### PUT /api/rules/:id

Updates an existing rule.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the rule to update |

**Request body**

Same schema as POST (all fields, `id` is not accepted in the body).

**Response** `200 OK`

Returns the updated rule object.

**Error responses**

- `400 Bad Request` — Validation failed (same `fieldErrors` format as POST)
- `404 Not Found` — No rule with the given ID

```json
{ "error": "Rule not found" }
```

---

### DELETE /api/rules/:id

Deletes a rule by ID.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the rule to delete |

**Response** `204 No Content`

No body.

**Error response** `404 Not Found`

```json
{ "error": "Rule not found" }
```

---

## Audit Log

### GET /api/audit

Returns paginated audit log entries.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `integer` | `1` | 1-based page number |
| `pageSize` | `integer` | `10` | Entries per page (1–100) |
| `startDate` | `string` | — | ISO 8601 lower bound (inclusive) |
| `endDate` | `string` | — | ISO 8601 upper bound (inclusive) |
| `agentId` | `string` | — | Exact match filter on agent ID |
| `resourceType` | `string` | — | Exact match filter on resource type |

**Response** `200 OK`

```json
{
  "entries": [
    {
      "timestamp": "2024-01-15T10:30:00.000Z",
      "policyId": "document-access",
      "policyName": "Document Access",
      "context": {
        "subject": { "id": "user-1", "role": "editor" },
        "resource": { "id": "doc-42", "type": "document" },
        "action": "write",
        "environment": {}
      },
      "result": {
        "allowed": true,
        "effect": "allow",
        "matchedRuleId": "editor-write",
        "reason": "Editors can write"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 142,
    "totalPages": 15
  }
}
```

**Entry fields**

| Field | Type | Description |
|---|---|---|
| `timestamp` | `string` | ISO 8601 decision timestamp |
| `policyId` | `string` | ID of the evaluated policy |
| `policyName` | `string` | Human-readable policy name |
| `context` | `object` | Evaluation context (subject, resource, action, environment) |
| `result.allowed` | `boolean` | Whether access was permitted |
| `result.effect` | `string` | Matched effect (`"allow"` / `"deny"` or `"permit"` / `"forbid"`) |
| `result.matchedRuleId` | `string` \| `null` | ID of the rule that matched |
| `result.reason` | `string` \| `null` | Rule's reason string |

---

### GET /api/audit/stream

Streams live audit entries as Server-Sent Events.

**Response** `200 OK`
Content-Type: `text/event-stream`

Each event is a JSON-encoded audit entry:

```
data: {"timestamp":"2024-01-15T10:30:01.000Z","policyId":"...","result":{"allowed":true,...}}

data: {"timestamp":"2024-01-15T10:30:02.000Z",...}
```

The connection stays open until the client disconnects. Clients should reconnect on error.

**JavaScript example**

```javascript
const source = new EventSource("/api/audit/stream");

source.onmessage = (event) => {
  const entry = JSON.parse(event.data);
  console.log(entry.timestamp, entry.result.allowed);
};

source.onerror = () => {
  // Reconnect after a delay
  source.close();
  setTimeout(() => reconnect(), 3000);
};
```

---

### POST /api/audit

Records an audit entry and broadcasts it to all connected SSE clients.

**Request body**

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "policyId": "document-access",
  "policyName": "Document Access",
  "context": { ... },
  "result": { "allowed": true, "effect": "allow" }
}
```

The `timestamp` and `result.effect` fields are required.

**Response** `201 Created`

No body.

**Error response** `400 Bad Request`

```json
{ "error": "Missing required fields: timestamp, effect" }
```

---

## Error Responses

All error responses follow this structure:

```json
{
  "error": "Human-readable error message",
  "fieldErrors": [
    { "field": "fieldName", "message": "What is wrong" }
  ]
}
```

The `fieldErrors` array is only present on `400` validation errors.

**HTTP status codes used**

| Code | Meaning |
|---|---|
| `200` | Success with body |
| `201` | Created |
| `204` | Success, no body |
| `400` | Validation error |
| `404` | Resource not found |
| `500` | Unexpected server error |
