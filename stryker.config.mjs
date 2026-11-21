export default {
  plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'html'],
  mutate: ['src/**/*.ts'],
};
