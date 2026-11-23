// Better GHub - Path-based label suggestions (pure, unit-tested).
//
// Directory names are anchored to a path segment: `(^|/)tests?/` so that
// `src/latest/x.ts` is not a test, `(^|/)lang/` so that `golang/` is not i18n.

export type LabelId =
  | 'needs-tests' | 'has-tests' | 'styling' | 'database' | 'documentation' | 'infrastructure' | 'ci'
  | 'dependencies' | 'i18n' | 'config' | 'api' | 'media' | 'build' | 'security';

const RULES: [RegExp, LabelId][] = [
  [/\.(css|scss|sass|less|styl|woff2?|ttf|otf|eot)$/i, 'styling'],
  [/\.sql$|(^|\/)(migrations?|migrate)\//i, 'database'],
  [/(^|\/)docs?\/|\.mdx?$|\.rst$/i, 'documentation'],
  [/(^|\/)(Dockerfile|docker-compose[^/]*|Containerfile)$|\.tf$|(^|\/)(terraform|k8s|kubernetes|helm|charts)\//i, 'infrastructure'],
  [/(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)\.circleci\/|(^|\/)Jenkinsfile$/i, 'ci'],
  [/(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|requirements[^/]*\.txt|poetry\.lock|composer\.(json|lock))$/i, 'dependencies'],
  [/(^|\/)(_locales|locales?|translations|i18n|lang)\/.*\.(json|ya?ml|po|pot|xlf|xliff|resx|strings|arb|properties)$/i, 'i18n'],
  [/(^|\/)(\.eslintrc[^/]*|\.prettierrc[^/]*|\.editorconfig|\.browserslistrc|tsconfig[^/]*\.json|babel\.config\.[^/]+|jest\.config\.[^/]+|vitest\.config\.[^/]+)$/i, 'config'],
  [/(^|\/)(api|routes|controllers|endpoints|handlers)\//i, 'api'],
  [/\.(png|jpe?g|gif|svg|ico|webp|avif|mp4|webm|mov|mp3|wav)$/i, 'media'],
  [/(^|\/)(webpack|esbuild|vite|rollup)\.config\.[^/]+$|(^|\/)(Makefile|Gruntfile\.[^/]+|gulpfile\.[^/]+)$/i, 'build'],
  [/(^|\/)(auth|security)\/|(^|\/)\.env\.example$|(^|\/)SECURITY\.md$/i, 'security'],
];

export const TEST_PATTERN =
  /(^|\/)(tests?|__tests__|spec|specs|e2e)\/|\.(test|spec)\.[^/]+$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$/i;
const SOURCE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|ex|exs)$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATTERN.test(path);
}

/**
 * Suggested labels for a set of changed paths. `complete` = the path list is
 * the whole PR; when it was truncated we cannot claim tests are missing.
 */
export function suggestLabels(paths: string[], complete = true): LabelId[] {
  if (!paths.length) return [];
  const found = new Set<LabelId>();
  let hasTests = false;
  let hasSource = false;
  for (const path of paths) {
    const test = isTestPath(path);
    if (test) hasTests = true;
    else if (SOURCE_PATTERN.test(path)) hasSource = true;
    for (const [re, label] of RULES) if (re.test(path)) found.add(label);
  }
  const out: LabelId[] = [];
  if (hasSource && !hasTests && complete) out.push('needs-tests');
  out.push(...RULES.map(([, l]) => l).filter((l, i, all) => found.has(l) && all.indexOf(l) === i));
  if (hasTests) out.push('has-tests');
  return out;
}
