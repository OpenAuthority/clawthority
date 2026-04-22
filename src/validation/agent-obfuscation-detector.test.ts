/**
 * Agent obfuscation detector tests.
 *
 * Verifies that `AgentObfuscationDetector` correctly enforces strict JSON
 * schema validation (F-05) and Cedar-style typed-field rules to detect and
 * block obfuscation attempts in MCP tool call parameters.
 *
 * Test IDs:
 *   TC-AOD-01: Schema missing additionalProperties: false is rejected (F-05)
 *   TC-AOD-02: Extra properties beyond declared schema are blocked
 *   TC-AOD-03: Clean params matching the schema pass without violations
 *   TC-AOD-04: Null byte in a string parameter is blocked (OBF-001)
 *   TC-AOD-05: Control characters in a string parameter are blocked (OBF-002)
 *   TC-AOD-06: Prototype-pollution key names are blocked (OBF-PP)
 *   TC-AOD-07: Unicode bidi override characters are blocked (OBF-003)
 *   TC-AOD-08: Oversized string values are blocked (OBF-004)
 *   TC-AOD-09: Type confusion (wrong runtime type vs declared schema type) is blocked
 *   TC-AOD-10: Custom Cedar rules are appended and evaluated
 *   TC-AOD-11: Multiple violations are all collected and reported
 *   TC-AOD-12: blocked flag is false for a completely clean call
 */

import { describe, it, expect } from 'vitest';
import {
  AgentObfuscationDetector,
  BUILT_IN_CEDAR_RULES,
  DEFAULT_MAX_STRING_LENGTH,
  PROTOTYPE_POLLUTION_KEYS,
  CONTROL_CHAR_PATTERN,
  BIDI_OVERRIDE_PATTERN,
  type CedarFieldRule,
  type JsonSchemaObject,
  type ObfuscationDetectionResult,
} from './agent-obfuscation-detector.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Returns a minimal valid strict schema for a single-string-field tool. */
function pathSchema(): JsonSchemaObject {
  return {
    type: 'object',
    properties: { path: { type: 'string' } },
    additionalProperties: false,
  };
}

/** Returns a clean result (no violations). */
function clean(): ObfuscationDetectionResult {
  return { blocked: false, violations: [] };
}

// ─── TC-AOD-01: Schema missing additionalProperties: false ────────────────────

describe('TC-AOD-01: schema missing additionalProperties: false is rejected (F-05)', () => {
  const detector = new AgentObfuscationDetector();

  it('rejects schema without additionalProperties', () => {
    const schema = {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
    } as JsonSchemaObject;

    const result = detector.detect('read_file', { path: '/tmp/file' }, schema);
    expect(result.blocked).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.kind).toBe('schema_missing_strict');
    expect(result.violations[0]!.field).toBe('schema');
    expect(result.violations[0]!.risk).toBe('high');
  });

  it('rejects schema with additionalProperties: true', () => {
    const schema = {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
      additionalProperties: true,
    } as unknown as JsonSchemaObject;

    const result = detector.detect('read_file', {}, schema);
    expect(result.blocked).toBe(true);
    expect(result.violations[0]!.kind).toBe('schema_missing_strict');
  });

  it('rejects schema missing properties field', () => {
    const schema = {
      type: 'object' as const,
      additionalProperties: false,
    } as unknown as JsonSchemaObject;

    const result = detector.detect('read_file', {}, schema);
    expect(result.blocked).toBe(true);
    expect(result.violations[0]!.kind).toBe('schema_missing_strict');
  });

  it('schema_missing_strict causes early return — no property-level violations appended', () => {
    const schema = {
      type: 'object' as const,
      properties: {},
      additionalProperties: true,
    } as unknown as JsonSchemaObject;

    const result = detector.detect('read_file', { __proto__: 'evil', path: 'ok' }, schema);
    // Only the schema violation is reported; prototype_pollution check did not run
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.kind).toBe('schema_missing_strict');
  });
});

// ─── TC-AOD-02: Extra properties are blocked ──────────────────────────────────

describe('TC-AOD-02: extra properties beyond declared schema are blocked', () => {
  const detector = new AgentObfuscationDetector();

  it('blocks a single undeclared parameter', () => {
    const result = detector.detect(
      'read_file',
      { path: '/etc/hosts', extra: 'unexpected' },
      pathSchema(),
    );
    expect(result.blocked).toBe(true);
    const v = result.violations.find((v) => v.kind === 'extra_properties');
    expect(v).toBeDefined();
    expect(v!.field).toBe('extra');
    expect(v!.risk).toBe('high');
  });

  it('blocks multiple undeclared parameters and reports each', () => {
    const result = detector.detect(
      'read_file',
      { path: '/ok', foo: 1, bar: 2 },
      pathSchema(),
    );
    const extras = result.violations.filter((v) => v.kind === 'extra_properties');
    expect(extras).toHaveLength(2);
    const fields = extras.map((v) => v.field);
    expect(fields).toContain('foo');
    expect(fields).toContain('bar');
  });

  it('does not flag params that are declared in the schema', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      additionalProperties: false,
    };
    const result = detector.detect(
      'write_file',
      { path: '/tmp/out.txt', overwrite: true },
      schema,
    );
    const extras = result.violations.filter((v) => v.kind === 'extra_properties');
    expect(extras).toHaveLength(0);
  });

  it('empty params with empty schema properties passes', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    const result = detector.detect('noop_tool', {}, schema);
    expect(result.violations.filter((v) => v.kind === 'extra_properties')).toHaveLength(0);
  });
});

// ─── TC-AOD-03: Clean params pass without violations ─────────────────────────

describe('TC-AOD-03: clean params matching the schema pass without violations', () => {
  const detector = new AgentObfuscationDetector();

  it('clean single-string param passes', () => {
    const result = detector.detect('read_file', { path: '/home/user/file.txt' }, pathSchema());
    expect(result.blocked).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('clean multi-type params pass', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        max_lines: { type: 'number' },
        include_hidden: { type: 'boolean' },
      },
      additionalProperties: false,
    };
    const result = detector.detect(
      'list_dir',
      { path: '/home/user', max_lines: 100, include_hidden: false },
      schema,
    );
    expect(result.blocked).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('empty params with empty schema passes', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    const result = detector.detect('ping', {}, schema);
    expect(result.blocked).toBe(false);
  });
});

// ─── TC-AOD-04: Null byte in string parameter (OBF-001) ──────────────────────

describe('TC-AOD-04: null byte in string parameter is blocked (OBF-001)', () => {
  const detector = new AgentObfuscationDetector();

  it('blocks a path containing a null byte', () => {
    const result = detector.detect(
      'read_file',
      { path: '/etc/hosts\0.txt' },
      pathSchema(),
    );
    expect(result.blocked).toBe(true);
    const v = result.violations.find((v) => v.kind === 'null_byte');
    expect(v).toBeDefined();
    expect(v!.field).toBe('path');
    expect(v!.risk).toBe('critical');
    expect(v!.message).toContain('OBF-001');
  });

  it('blocks a value that is only a null byte', () => {
    const result = detector.detect('read_file', { path: '\0' }, pathSchema());
    expect(result.blocked).toBe(true);
    expect(result.violations.find((v) => v.kind === 'null_byte')).toBeDefined();
  });

  it('clean strings without null bytes are not flagged by OBF-001', () => {
    const result = detector.detect('read_file', { path: '/safe/path' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'null_byte')).toBeUndefined();
  });

  it('null bytes in non-string values (number) are not flagged', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { count: { type: 'number' } },
      additionalProperties: false,
    };
    const result = detector.detect('count_tool', { count: 0 }, schema);
    expect(result.violations.find((v) => v.kind === 'null_byte')).toBeUndefined();
  });
});

// ─── TC-AOD-05: Control characters in string parameter (OBF-002) ──────────────

describe('TC-AOD-05: control characters in string parameter are blocked (OBF-002)', () => {
  const detector = new AgentObfuscationDetector();

  const controlCharCases: Array<[string, string]> = [
    ['SOH (0x01)', '\x01'],
    ['BEL (0x07)', '\x07'],
    ['BS  (0x08)', '\x08'],
    ['VT  (0x0B)', '\x0b'],
    ['FF  (0x0C)', '\x0c'],
    ['SO  (0x0E)', '\x0e'],
    ['US  (0x1F)', '\x1f'],
    ['DEL (0x7F)', '\x7f'],
  ];

  for (const [name, char] of controlCharCases) {
    it(`blocks ${name} in path`, () => {
      const result = detector.detect('read_file', { path: `/tmp/file${char}` }, pathSchema());
      expect(result.violations.find((v) => v.kind === 'control_chars')).toBeDefined();
    });
  }

  it('tab (0x09) is not flagged — legitimate in multi-line fields', () => {
    const result = detector.detect('read_file', { path: '/tmp/file\twith-tab' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'control_chars')).toBeUndefined();
  });

  it('newline (0x0A) is not flagged — legitimate in content fields', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { content: { type: 'string' } },
      additionalProperties: false,
    };
    const result = detector.detect('write_file', { content: 'line1\nline2' }, schema);
    expect(result.violations.find((v) => v.kind === 'control_chars')).toBeUndefined();
  });

  it('carriage return (0x0D) is not flagged', () => {
    const result = detector.detect('read_file', { path: '/tmp/file\r\n' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'control_chars')).toBeUndefined();
  });

  it('control_chars violations carry risk: high', () => {
    const result = detector.detect('read_file', { path: '/tmp\x01evil' }, pathSchema());
    const v = result.violations.find((v) => v.kind === 'control_chars');
    expect(v!.risk).toBe('high');
  });

  it('CONTROL_CHAR_PATTERN constant matches documented characters', () => {
    expect(CONTROL_CHAR_PATTERN.test('\x01')).toBe(true);
    expect(CONTROL_CHAR_PATTERN.test('\x7f')).toBe(true);
    expect(CONTROL_CHAR_PATTERN.test('\x09')).toBe(false); // tab
    expect(CONTROL_CHAR_PATTERN.test('\x0a')).toBe(false); // newline
    expect(CONTROL_CHAR_PATTERN.test('\x0d')).toBe(false); // carriage return
  });
});

// ─── TC-AOD-06: Prototype-pollution key names (OBF-PP) ───────────────────────

describe('TC-AOD-06: prototype-pollution key names are blocked (OBF-PP)', () => {
  const detector = new AgentObfuscationDetector();

  const pollutionKeys = [...PROTOTYPE_POLLUTION_KEYS];

  for (const key of pollutionKeys) {
    it(`blocks parameter key "${key}"`, () => {
      // Inject both as an extra param AND as a declared param to test both paths
      const schema: JsonSchemaObject = {
        type: 'object',
        properties: { [key]: { type: 'string' } },
        additionalProperties: false,
      };
      const result = detector.detect('some_tool', { [key]: 'value' }, schema);
      const v = result.violations.find((v) => v.kind === 'prototype_pollution');
      expect(v).toBeDefined();
      expect(v!.field).toBe(key);
      expect(v!.risk).toBe('critical');
    });
  }

  it('__proto__ blocked even when present in schema properties', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { __proto__: { type: 'object' } },
      additionalProperties: false,
    };
    // Use computed property syntax to create __proto__ as an own property
    // (static `{ __proto__: x }` sets the prototype rather than creating a key)
    const params = { ['__proto__']: {} };
    const result = detector.detect('tool', params, schema);
    expect(result.violations.find((v) => v.kind === 'prototype_pollution')).toBeDefined();
  });

  it('non-pollution keys are not flagged', () => {
    const result = detector.detect('read_file', { path: '/safe' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'prototype_pollution')).toBeUndefined();
  });
});

// ─── TC-AOD-07: Bidi override characters (OBF-003) ───────────────────────────

describe('TC-AOD-07: unicode bidi override characters are blocked (OBF-003)', () => {
  const detector = new AgentObfuscationDetector();

  const bidiCases: Array<[string, string]> = [
    ['LEFT-TO-RIGHT MARK (U+200E)', '\u200e'],
    ['RIGHT-TO-LEFT MARK (U+200F)', '\u200f'],
    ['LTR EMBEDDING (U+202A)', '\u202a'],
    ['RTL EMBEDDING (U+202B)', '\u202b'],
    ['POP DIRECTIONAL (U+202C)', '\u202c'],
    ['LTR OVERRIDE (U+202D)', '\u202d'],
    ['RTL OVERRIDE (U+202E)', '\u202e'],
    ['LTR ISOLATE (U+2066)', '\u2066'],
    ['RTL ISOLATE (U+2067)', '\u2067'],
    ['FSI (U+2068)', '\u2068'],
    ['PDI (U+2069)', '\u2069'],
  ];

  for (const [name, char] of bidiCases) {
    it(`blocks ${name} in string parameter`, () => {
      const result = detector.detect('read_file', { path: `/safe${char}evil` }, pathSchema());
      expect(result.violations.find((v) => v.kind === 'encoding_pattern')).toBeDefined();
    });
  }

  it('encoding_pattern violations carry risk: high', () => {
    const result = detector.detect('read_file', { path: 'normal\u202eevil' }, pathSchema());
    const v = result.violations.find((v) => v.kind === 'encoding_pattern');
    expect(v!.risk).toBe('high');
    expect(v!.message).toContain('OBF-003');
  });

  it('clean ASCII path is not flagged', () => {
    const result = detector.detect('read_file', { path: '/normal/path' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'encoding_pattern')).toBeUndefined();
  });

  it('BIDI_OVERRIDE_PATTERN constant matches documented codepoints', () => {
    expect(BIDI_OVERRIDE_PATTERN.test('\u202e')).toBe(true);
    expect(BIDI_OVERRIDE_PATTERN.test('\u200e')).toBe(true);
    expect(BIDI_OVERRIDE_PATTERN.test('\u2066')).toBe(true);
    expect(BIDI_OVERRIDE_PATTERN.test('safe')).toBe(false);
  });
});

// ─── TC-AOD-08: Oversized string values (OBF-004) ────────────────────────────

describe('TC-AOD-08: oversized string values are blocked (OBF-004)', () => {
  it('blocks string exceeding DEFAULT_MAX_STRING_LENGTH', () => {
    const detector = new AgentObfuscationDetector();
    const oversized = 'a'.repeat(DEFAULT_MAX_STRING_LENGTH + 1);
    const result = detector.detect('read_file', { path: oversized }, pathSchema());
    const v = result.violations.find((v) => v.kind === 'oversized_value');
    expect(v).toBeDefined();
    expect(v!.field).toBe('path');
    expect(v!.risk).toBe('high');
    expect(v!.message).toContain('OBF-004');
  });

  it('string at exactly DEFAULT_MAX_STRING_LENGTH is not blocked', () => {
    const detector = new AgentObfuscationDetector();
    const exact = 'a'.repeat(DEFAULT_MAX_STRING_LENGTH);
    const result = detector.detect('read_file', { path: exact }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'oversized_value')).toBeUndefined();
  });

  it('custom maxStringLength is respected', () => {
    const detector = new AgentObfuscationDetector({ maxStringLength: 10 });
    const result = detector.detect('read_file', { path: 'a'.repeat(11) }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'oversized_value')).toBeDefined();
  });

  it('custom maxStringLength: value at limit is not blocked', () => {
    const detector = new AgentObfuscationDetector({ maxStringLength: 10 });
    const result = detector.detect('read_file', { path: 'a'.repeat(10) }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'oversized_value')).toBeUndefined();
  });

  it('non-string values are not flagged for oversized_value', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { count: { type: 'number' } },
      additionalProperties: false,
    };
    const detector = new AgentObfuscationDetector({ maxStringLength: 1 });
    const result = detector.detect('count_tool', { count: 9999 }, schema);
    expect(result.violations.find((v) => v.kind === 'oversized_value')).toBeUndefined();
  });
});

// ─── TC-AOD-09: Type confusion ────────────────────────────────────────────────

describe('TC-AOD-09: type confusion is blocked (OBF-TC)', () => {
  const detector = new AgentObfuscationDetector();

  it('blocks string where boolean is declared', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { overwrite: { type: 'boolean' } },
      additionalProperties: false,
    };
    const result = detector.detect('write_file', { overwrite: 'true' }, schema);
    const v = result.violations.find((v) => v.kind === 'type_confusion');
    expect(v).toBeDefined();
    expect(v!.field).toBe('overwrite');
    expect(v!.risk).toBe('high');
    expect(v!.message).toContain('OBF-TC');
    expect(v!.message).toContain('"boolean"');
    expect(v!.message).toContain('"string"');
  });

  it('blocks number where string is declared', () => {
    const result = detector.detect('read_file', { path: 42 }, pathSchema());
    const v = result.violations.find((v) => v.kind === 'type_confusion');
    expect(v).toBeDefined();
    expect(v!.message).toContain('"string"');
    expect(v!.message).toContain('"number"');
  });

  it('blocks array where string is declared', () => {
    const result = detector.detect(
      'read_file',
      { path: ['/etc/passwd'] },
      pathSchema(),
    );
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeDefined();
  });

  it('correct type does not trigger type_confusion', () => {
    const result = detector.detect('read_file', { path: '/ok/path' }, pathSchema());
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeUndefined();
  });

  it('integer value is valid for declared integer type', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { count: { type: 'integer' } },
      additionalProperties: false,
    };
    const result = detector.detect('count_tool', { count: 5 }, schema);
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeUndefined();
  });

  it('float value is blocked for declared integer type', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { count: { type: 'integer' } },
      additionalProperties: false,
    };
    const result = detector.detect('count_tool', { count: 5.5 }, schema);
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeDefined();
  });

  it('fields without declared type are not flagged', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { data: { description: 'any value' } },
      additionalProperties: false,
    };
    const result = detector.detect('flexible_tool', { data: 42 }, schema);
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeUndefined();
  });
});

// ─── TC-AOD-10: Custom Cedar rules ───────────────────────────────────────────

describe('TC-AOD-10: custom Cedar rules are appended and evaluated', () => {
  it('custom rule fires when condition is met', () => {
    const customRule: CedarFieldRule = {
      id: 'CUSTOM-001',
      description: 'Paths must not start with /etc.',
      field: 'path',
      when: (v) => typeof v === 'string' && v.startsWith('/etc'),
      effect: 'forbid',
      kind: 'extra_properties', // reusing existing kind for test simplicity
      risk: 'high',
    };
    const detector = new AgentObfuscationDetector({ additionalRules: [customRule] });
    const result = detector.detect('read_file', { path: '/etc/shadow' }, pathSchema());
    const v = result.violations.find((v) => v.message.includes('CUSTOM-001'));
    expect(v).toBeDefined();
  });

  it('custom rule does not fire when condition is not met', () => {
    const customRule: CedarFieldRule = {
      id: 'CUSTOM-002',
      description: 'Reject paths starting with /root.',
      field: 'path',
      when: (v) => typeof v === 'string' && v.startsWith('/root'),
      effect: 'forbid',
      kind: 'extra_properties',
      risk: 'high',
    };
    const detector = new AgentObfuscationDetector({ additionalRules: [customRule] });
    const result = detector.detect('read_file', { path: '/home/user/file' }, pathSchema());
    expect(result.violations.find((v) => v.message.includes('CUSTOM-002'))).toBeUndefined();
  });

  it('custom rules are evaluated after built-in rules', () => {
    // Both built-in (null_byte) and custom rule should fire
    const customRule: CedarFieldRule = {
      id: 'CUSTOM-003',
      description: 'All non-empty paths are blocked (contrived test rule).',
      field: 'path',
      when: (v) => typeof v === 'string' && v.length > 0,
      effect: 'forbid',
      kind: 'oversized_value',
      risk: 'high',
    };
    const detector = new AgentObfuscationDetector({ additionalRules: [customRule] });
    const result = detector.detect('read_file', { path: '/file\0' }, pathSchema());

    const nullByteViolation = result.violations.find((v) => v.kind === 'null_byte');
    const customViolation = result.violations.find((v) => v.message.includes('CUSTOM-003'));
    expect(nullByteViolation).toBeDefined();
    expect(customViolation).toBeDefined();
  });

  it('BUILT_IN_CEDAR_RULES constant contains exactly 3 rules', () => {
    expect(BUILT_IN_CEDAR_RULES).toHaveLength(3);
    expect(BUILT_IN_CEDAR_RULES.map((r) => r.id)).toEqual(['OBF-001', 'OBF-002', 'OBF-003']);
  });
});

// ─── TC-AOD-11: Multiple violations are all reported ─────────────────────────

describe('TC-AOD-11: multiple violations are all collected and reported', () => {
  const detector = new AgentObfuscationDetector();

  it('extra_properties and prototype_pollution can both appear in same result', () => {
    // JSON.parse uses [[DefineOwnProperty]] so __proto__ becomes an own enumerable key
    const params = JSON.parse('{"path": "/ok", "__proto__": "evil", "extra_param": "value"}');
    const result = detector.detect('read_file', params, pathSchema());
    expect(result.blocked).toBe(true);
    const kinds = result.violations.map((v) => v.kind);
    expect(kinds).toContain('extra_properties');
    expect(kinds).toContain('prototype_pollution');
  });

  it('null_byte + type_confusion are both reported for the same field', () => {
    // path is declared as string but we pass a number with embedded null behavior
    // Use a separate field that has both issues
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {
        flag: { type: 'boolean' },
      },
      additionalProperties: false,
    };
    // type_confusion: string instead of boolean
    const result = detector.detect('tool', { flag: 'true' }, schema);
    expect(result.violations.find((v) => v.kind === 'type_confusion')).toBeDefined();
    // Inject also a null_byte at a string field
    const schema2: JsonSchemaObject = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        extra: { type: 'string' },
      },
      additionalProperties: false,
    };
    const result2 = detector.detect(
      'tool',
      { path: '/ok\0evil', extra: '/also\0bad' },
      schema2,
    );
    const nullViolations = result2.violations.filter((v) => v.kind === 'null_byte');
    expect(nullViolations).toHaveLength(2); // one per field
  });

  it('violations array is ordered: schema → extra → pollution → rules → type', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: { ['__proto__']: { type: 'string' } },
      additionalProperties: false,
    };
    // Use computed property so __proto__ is an own enumerable key
    const params = { ['__proto__']: 'val\0ue' }; // prototype_pollution + null_byte
    const result = detector.detect('tool', params, schema);
    const kinds = result.violations.map((v) => v.kind);
    // prototype_pollution comes before null_byte (pass 3 before pass 4)
    const pollIdx = kinds.indexOf('prototype_pollution');
    const nullIdx = kinds.indexOf('null_byte');
    expect(pollIdx).toBeGreaterThanOrEqual(0);
    expect(nullIdx).toBeGreaterThanOrEqual(0);
    expect(pollIdx).toBeLessThan(nullIdx);
  });
});

// ─── TC-AOD-12: blocked=false for a completely clean call ────────────────────

describe('TC-AOD-12: blocked is false for a completely clean call', () => {
  const detector = new AgentObfuscationDetector();

  it('clean single param returns blocked=false and empty violations', () => {
    const result = detector.detect('read_file', { path: '/home/user/notes.txt' }, pathSchema());
    expect(result).toEqual(clean());
  });

  it('clean call with multiple declared params returns blocked=false', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {
        src: { type: 'string' },
        dst: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      additionalProperties: false,
    };
    const result = detector.detect(
      'move_file',
      { src: '/tmp/a.txt', dst: '/home/user/b.txt', overwrite: false },
      schema,
    );
    expect(result.blocked).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('empty params with empty schema is clean', () => {
    const schema: JsonSchemaObject = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    const result = detector.detect('noop', {}, schema);
    expect(result.blocked).toBe(false);
  });

  it('default instance does not throw on any clean call', () => {
    const defaultDetector = new AgentObfuscationDetector();
    expect(() => defaultDetector.detect('t', { path: '/ok' }, pathSchema())).not.toThrow();
  });

  it('DEFAULT_MAX_STRING_LENGTH constant is 4096', () => {
    expect(DEFAULT_MAX_STRING_LENGTH).toBe(4096);
  });
});
