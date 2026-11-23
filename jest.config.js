/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  globals: { __DEV__: false },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Coverage is measured AND gated ONLY on the pure-logic modules below, which
  // have unit tests. The DOM/messaging entry points (background, content,
  // dashboard, ui, pr-shortcuts, popup, options) register chrome listeners at
  // module load and are validated by manual/integration testing, not unit
  // coverage — instrumenting them here would break `jest --coverage`.
  collectCoverageFrom: [
    'src/shortcuts.ts',
    'src/core/page.ts',
    'src/core/settings.ts',
    'src/redact.ts',
  ],
  // Per-path thresholds (not a `global` gate) so this block self-documents
  // exactly what is enforced: each tested pure-logic module carries its own
  // floor, set a bit below current actuals so small future edits do not trip
  // the gate. Entry points are intentionally absent — they are covered by
  // manual/integration testing, not unit coverage.
  coverageThreshold: {
    './src/shortcuts.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
    './src/core/page.ts': { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};
