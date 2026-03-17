# Registry API Examples

## JSON Schemas

### LLM Model
```json
{
  "type": "object",
  "required": ["provider", "modelId"],
  "properties": {
    "provider": {
      "type": "string",
      "enum": ["together", "openai", "anthropic", "google", "custom"]
    },
    "modelId": { "type": "string" },
    "endpointUrl": { "type": "string", "format": "uri" },
    "pricePer1kInputTokens": { "type": "number" },
    "pricePer1kOutputTokens": { "type": "number" },
    "defaultRateLimit": { "type": "integer", "default": 60 },
    "metadata": { "type": "object" }
  }
}
```

### Agent
```json
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": { "type": "string" },
    "type": { "type": "string", "enum": ["openclaw", "custom", "workflow"] },
    "config": { "type": "object" }
  }
}
```

### Skill
```json
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": { "type": "string" },
    "type": { "type": "string", "enum": ["openclaw", "custom", "builtin"] },
    "config": { "type": "object" },
    "isOpenClawEnabled": { "type": "boolean" }
  }
}
```

### Policy Binding
```json
{
  "type": "object",
  "required": ["policyId", "targetType", "targetId"],
  "properties": {
    "policyId": { "type": "string", "format": "uuid" },
    "targetType": { "type": "string", "enum": ["model", "agent", "skill"] },
    "targetId": { "type": "string", "format": "uuid" },
    "config": { "type": "object" }
  }
}
```

## Example Payloads

### 1. Register a Together.ai Model

**Request:**
```bash
POST /models
Content-Type: application/json

{
  "provider": "together",
  "modelId": "togetherai/m2-mini-fast",
  "endpointUrl": "https://api.together.xyz/v1/chat/completions",
  "pricePer1kInputTokens": 0.0004,
  "pricePer1kOutputTokens": 0.0004,
  "defaultRateLimit": 60,
  "metadata": {
    "contextWindow": 128000,
    "supportsStreaming": true
  }
}
```

**Response:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "provider": "together",
  "modelId": "togetherai/m2-mini-fast",
  "endpointUrl": "https://api.together.xyz/v1/chat/completions",
  "pricePer1kInputTokens": 0.0004,
  "pricePer1kOutputTokens": 0.0004,
  "defaultRateLimit": 60,
  "metadata": {
    "contextWindow": 128000,
    "supportsStreaming": true
  },
  "isActive": true,
  "createdAt": "2026-03-16T12:00:00Z",
  "updatedAt": "2026-03-16T12:00:00Z"
}
```

### 2. Create an Agent

**Request:**
```bash
POST /tenants/{tenantId}/agents
Content-Type: application/json

{
  "name": "my-openclaw-agent",
  "type": "openclaw",
  "config": {
    "maxIterations": 10,
    "toolTimeout": 30000
  }
}
```

### 3. Create a Skill (OpenClaw enabled)

**Request:**
```bash
POST /tenants/{tenantId}/skills
Content-Type: application/json

{
  "name": "web-scraper",
  "type": "openclaw",
  "config": {
    "capabilities": ["http", "scrape", "parse"]
  },
  "isOpenClawEnabled": true
}
```

### 4. Create a Spend-Cap Policy

First, create the SecuritySPEC policy:
```bash
POST /tenants/{tenantId}/policies
Content-Type: application/json

{
  "name": "spend-cap-policy",
  "description": "Limits spending to $100/month per model",
  "spec": {
    "rules": [
      {
        "effect": "permit",
        "conditions": [
          {
            "attribute": "spend",
            "operator": "lte",
            "value": 100
          }
        ]
      },
      {
        "effect": "deny",
        "conditions": [
          {
            "attribute": "spend",
            "operator": "gt",
            "value": 100
          }
        ]
      }
    ]
  }
}
```

### 5. Attach Spend-Cap Policy to Model

**Request:**
```bash
POST /policy-bindings
Content-Type: application/json

{
  "policyId": "b2c3d4e5-f6a7-8901-bcde-f1234567890",
  "targetType": "model",
  "targetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "config": {
    "period": "monthly",
    "scope": "per-model"
  }
}
```

**Response:**
```json
{
  "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "policyId": "b2c3d4e5-f6a7-8901-bcde-f1234567890",
  "targetType": "model",
  "targetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "config": {
    "period": "monthly",
    "scope": "per-model"
  },
  "createdAt": "2026-03-16T12:00:00Z"
}
```

### 6. Detach Policy from Model

**Request:**
```bash
DELETE /policy-bindings
Content-Type: application/json

{
  "policyId": "b2c3d4e5-f6a7-8901-bcde-f1234567890",
  "targetType": "model",
  "targetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

## REST Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/models` | Register LLM model |
| GET | `/models` | List all models |
| GET | `/models/:id` | Get model by ID |
| PUT | `/models/:id` | Update model |
| DELETE | `/models/:id` | Delete model |
| POST | `/tenants/:tenantId/agents` | Register agent |
| GET | `/tenants/:tenantId/agents` | List tenant agents |
| GET | `/tenants/:tenantId/agents/:id` | Get agent by ID |
| PUT | `/tenants/:tenantId/agents/:id` | Update agent |
| DELETE | `/tenants/:tenantId/agents/:id` | Delete agent |
| POST | `/tenants/:tenantId/skills` | Register skill |
| GET | `/tenants/:tenantId/skills` | List tenant skills |
| GET | `/tenants/:tenantId/skills/:id` | Get skill by ID |
| PUT | `/tenants/:tenantId/skills/:id` | Update skill |
| DELETE | `/tenants/:tenantId/skills/:id` | Delete skill |
| POST | `/policy-bindings` | Attach policy to target |
| DELETE | `/policy-bindings` | Detach policy from target |
| GET | `/policy-bindings/:targetType/:targetId` | Get bindings for target |
