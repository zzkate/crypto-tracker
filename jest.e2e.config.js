/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  clearMocks: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  testTimeout: 30000,
  maxWorkers: 1
};
