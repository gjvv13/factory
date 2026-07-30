import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Gedeelde ESLint-configuratie voor alle applicaties uit de factory.
 * De regels horen bij CODING_GUIDELINES.md: wat afdwingbaar is, staat hier.
 *
 * Gebruik in een applicatie:
 *
 *   import { factoryEslint } from 'factory/eslint';
 *   export default factoryEslint({ tsconfigRootDir: import.meta.dirname });
 *
 * @param {object} options
 * @param {string} options.tsconfigRootDir  Meestal `import.meta.dirname` van de app.
 * @param {string[]} [options.extraIgnores] Extra paden die niet gelint worden.
 * @param {import('eslint').Linter.Config[]} [options.extraConfigs] Aanvullende blokken, achteraan toegevoegd.
 */
export function factoryEslint({ tsconfigRootDir, extraIgnores = [], extraConfigs = [] }) {
  return tseslint.config(
    {
      ignores: [
        'dist/**',
        'node_modules/**',
        'migrations/**',
        'data/**',
        'coverage/**',
        'pacts/**',
        '.tmp/**',
        ...extraIgnores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        // Expliciete grenzen: geen stille any's die het domein binnenlekken.
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        // Domeincode logt via de logger, niet naar stdout.
        'no-console': ['error', { allow: ['error'] }],
        eqeqeq: ['error', 'always'],
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message:
              'Gebruik de Clock-abstractie (app/src/core/clock.ts) in plaats van new Date().',
          },
        ],
      },
    },
    {
      // De CLI-achtige onderdelen mogen wel naar stdout schrijven.
      files: [
        'app/src/channels/cli-channel.ts',
        'app/src/db/seed.ts',
        'app/src/db/migrate.ts',
        'src/cli.ts',
        'src/commands/**/*.ts',
        'src/shell.ts',
      ],
      rules: { 'no-console': 'off' },
    },
    {
      // Configuratiebestanden in JavaScript staan buiten het TypeScript-project;
      // types komen daar uit JSDoc en niet uit annotaties.
      files: ['**/*.js', '**/*.cjs'],
      extends: [tseslint.configs.disableTypeChecked],
      rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
    },
    {
      // pm2 leest zijn configuratie als CommonJS.
      files: ['**/*.cjs'],
      languageOptions: {
        sourceType: 'commonjs',
        globals: {
          require: 'readonly',
          module: 'writable',
          exports: 'writable',
          __dirname: 'readonly',
          __filename: 'readonly',
          process: 'readonly',
        },
      },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
      // Tests mogen ruwer zijn: ze mogen tijd vastzetten en aannames hard maken.
      files: ['**/test/**/*.ts', '*.config.ts'],
      rules: {
        'no-console': 'off',
        'no-restricted-syntax': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
    prettier,
    ...extraConfigs,
  );
}

export default factoryEslint;
