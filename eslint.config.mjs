import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * Next's own flat config, which already includes the base `next` rules and the
 * TypeScript rules. Nothing is loosened here: a lint rule is turned off only in
 * a pull request that says which rule and why (AGENTS.md section 9).
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'coverage/**',
      'next-env.d.ts',
      'docs-ref/**',
    ],
  },
];

export default eslintConfig;
