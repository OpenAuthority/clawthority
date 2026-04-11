import { describe, it } from 'vitest';
import { validateCapability } from './stage1-capability.js';
import type { PipelineContext, CeeDecision } from './pipeline.js';

describe('validateCapability', () => {
  it.todo('forbids when source is untrusted and risk is high');
  it.todo('forbids when source is untrusted and risk is critical');
  it.todo('permits when source is untrusted but risk is low');
  it.todo('permits when source is untrusted but risk is medium');
  it.todo('permits when source is user regardless of risk');
  it.todo('permits when source is agent regardless of risk');
  it.todo('permits when hitl_mode is none (low-risk bypass)');
  it.todo('forbids when approval_id is missing');
  it.todo('forbids when capability is not found in the store');
  it.todo('forbids when capability TTL has expired');
  it.todo('forbids when payload hash binding does not match (SHA-256)');
  it.todo('forbids when capability has already been consumed');
  it.todo('forbids when session_id does not match capability scope');
  it.todo('permits when all checks pass');
  it.todo('fails closed with stage1_error when getCapability throws');
  it.todo('short-circuits on first failure without evaluating subsequent checks');
});

void validateCapability;
void ({} as PipelineContext);
void ({} as CeeDecision);
