import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Pruebas usan las fuentes de shared: no hace falta compilarlo antes.
  moduleNameMapper: { '^@apuestas/shared$': '<rootDir>/../../../packages/shared/src' },
};

export default config;
