/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  // Loaded before any module (entities read DB_DRIVER at import time).
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 20000,
};
