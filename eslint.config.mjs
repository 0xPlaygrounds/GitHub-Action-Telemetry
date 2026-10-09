import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'collect/dist/',
      'lib/',
      'node_modules/',
      'proc-tracer/',
      'posthog/canvas/'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/promise-function-async': 'error'
    }
  },
  { files: ['**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  {
    files: ['**/*.mjs'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  }
)
