import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.e2e.ts',
        'src/**/__mocks__/**',
      ],
      thresholds: {
        'src/enforcement/**': {
          lines: 95,
        },
        'src/hitl/**': {
          lines: 88,
        },
        'src/policy/**': {
          lines: 90,
        },
        'src/adapter/**': {
          lines: 85,
        },
        'src/index.ts': {
          lines: 35,
        },
      },
    },
  },
});
