-- Registry API Database Schema

-- LLM Models
CREATE TYPE model_provider AS ENUM ('together', 'openai', 'anthropic', 'google', 'custom');

CREATE TABLE llm_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  model_id VARCHAR(255) NOT NULL,
  endpoint_url TEXT,
  price_per_1k_input_tokens DECIMAL(10, 6),
  price_per_1k_output_tokens DECIMAL(10, 6),
  default_rate_limit INTEGER DEFAULT 60,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_llm_models_provider ON llm_models(provider);
CREATE INDEX idx_llm_models_model_id ON llm_models(model_id);

-- Agents
CREATE TYPE agent_type AS ENUM ('openclaw', 'custom', 'workflow');

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_tenant ON agents(tenant_id);

-- Skills
CREATE TYPE skill_type AS ENUM ('openclaw', 'custom', 'builtin');

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}',
  is_openclaw_enabled BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_skills_tenant ON skills(tenant_id);

-- Policy Bindings
CREATE TYPE policy_target_type AS ENUM ('model', 'agent', 'skill');

CREATE TABLE policy_bindings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  target_type VARCHAR(50) NOT NULL,
  target_id UUID NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(policy_id, target_type, target_id)
);

CREATE INDEX idx_policy_bindings_policy ON policy_bindings(policy_id);
CREATE INDEX idx_policy_bindings_target ON policy_bindings(target_type, target_id);
