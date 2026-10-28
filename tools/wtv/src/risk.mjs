// Plain heuristics. Cheap, explainable, and good enough to decide reading order.

const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|[^/]+\.csproj|Directory\.Packages\.props)$/;
const CONFIG = /(^|\/)(\.github\/workflows\/|\.gitlab-ci|azure-pipelines|Dockerfile|docker-compose|\.env|\.npmrc|tsconfig[^/]*\.json$|[^/]+\.config\.[cm]?[jt]s$|vite\.config|webpack\.config|eslint|\.eslintrc|\.prettierrc|vercel\.json|netlify\.toml|wrangler\.toml|serverless\.ya?ml|host\.json|local\.settings\.json|appsettings[^/]*\.json)/;
const SECURITY = /\b(auth\w*|token\w*|secret\w*|passw(or)?d|credential\w*|jwt|session|crypto|cipher|encrypt\w*|decrypt\w*|permission\w*|roles?|acl|csrf|cors|oauth|api[_-]?key|private[_-]?key|sanitize\w*|expir\w*)\b/i;
const EXEC = /\b(child_process|execSync|exec\(|spawn\(|eval\(|new Function\(|subprocess|os\.system|Runtime\.getRuntime|Process\.Start|shell=True)|dangerouslySetInnerHTML|\.innerHTML\s*=/;
const NETWORK = /\bfetch\(|\baxios\b|http\.request|https\.request|XMLHttpRequest|WebSocket\(|https?:\/\/(?!localhost|127\.0\.0\.1|example\.(com|org))[\w.-]+/;
const SUPPRESS = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|#\s*noqa|#\s*type:\s*ignore|\bas any\b|:\s*any\b|#pragma warning disable|@SuppressWarnings|nolint/;
const SKIP_TEST = /\b(it|test|describe)\.(skip|only|todo)\(|\bx(it|describe|test)\(|@Ignore\b|@Disabled\b|pytest\.mark\.skip|\[Ignore\]|t\.Skip\(/;
const ASSERT = /\b(expect|assert\w*|should|toBe|toEqual|toMatch|toThrow|toHaveBeenCalled\w*|Assert\.\w+|require\.\w+)\b/;
const SWALLOW = /catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+\w+)?\s*:\s*pass\b|\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
const API_DECL = /^\s*(export\s|module\.exports|exports\.\w+\s*=|public\s|def\s+[a-zA-Z]|func\s+[A-Z])/;
const TODO = /\b(TODO|FIXME|HACK|XXX)\b/;
const DEP_LINE = /^\s*"[@\w./-]+"\s*:\s*"(?:[~^<>=*]|\d|workspace:|file:|link:|git|https?:|latest|next)/;

export const SEVERITY = { high: 3, medium: 2, low: 1, none: 0 };

export function assessHunk(h) {
  if (h.whitespaceOnly) return { risks: [], level: 'none' };
  const risks = [];
  const add = (code, severity, label) => risks.push({ code, severity, label });
  const added = h.added.join('\n');
  const removed = h.removed.join('\n');
  const both = `${added}\n${removed}`;
  const isTest = TEST_PATH.test(h.path);

  if (h.lockfile) add('lockfile', 'low', 'Lockfile changed');

  if (MANIFEST.test(h.path)) {
    const depLines = [...h.added, ...h.removed].filter((l) => DEP_LINE.test(l)).length;
    if (h.path.endsWith('package.json') ? depLines > 0 : true) add('deps', 'high', 'Dependency change');
  }

  if (isTest) {
    const lostAsserts = h.removed.filter((l) => ASSERT.test(l)).length - h.added.filter((l) => ASSERT.test(l)).length;
    if (h.status === 'deleted') add('tests-weakened', 'high', 'Test file deleted');
    else if (lostAsserts > 0) add('tests-weakened', 'high', `Lost ${lostAsserts} assertion${lostAsserts > 1 ? 's' : ''}`);
    if (SKIP_TEST.test(added)) add('tests-weakened', 'high', 'Test skipped or focused');
  }

  if (!isTest && (SECURITY.test(h.path) || SECURITY.test(both))) add('security', 'high', 'Touches auth or security');
  if (EXEC.test(added)) add('exec', 'high', 'Code execution or raw HTML');
  if (CONFIG.test(h.path)) add('config', 'medium', 'Build, CI or runtime config');
  if (!isTest && NETWORK.test(added)) add('network', 'medium', 'New network call or URL');
  if (SUPPRESS.test(added)) add('suppression', 'medium', 'Lint or type check suppressed');
  if (SWALLOW.test(added)) add('swallowed-error', 'medium', 'Error swallowed');
  if (!isTest && h.removed.some((l) => API_DECL.test(l))) add('api', 'medium', 'Public API changed or removed');
  if (h.status === 'deleted' && !isTest) add('deleted', 'medium', 'File deleted');
  if (h.synthetic === 'binary') add('binary', 'medium', 'Binary file changed');
  if (TODO.test(added)) add('todo', 'low', 'New TODO or FIXME');
  if (h.added.length + h.removed.length > 150) add('large', 'low', 'Large hunk');

  // One entry per code, keep the most severe.
  const byCode = new Map();
  for (const r of risks) {
    const prev = byCode.get(r.code);
    if (!prev || SEVERITY[r.severity] > SEVERITY[prev.severity]) byCode.set(r.code, r);
  }
  const list = [...byCode.values()];
  const level = list.reduce((max, r) => (SEVERITY[r.severity] > SEVERITY[max] ? r.severity : max), 'none');
  return { risks: list, level };
}

/** Findings that only make sense across the whole change. */
export function assessChange(hunks) {
  const findings = [];
  const lockChanged = hunks.some((h) => h.lockfile);
  const manifestChanged = hunks.some((h) => MANIFEST.test(h.path));
  if (lockChanged && !manifestChanged) {
    findings.push({ code: 'lockfile-only', severity: 'medium', message: 'Lockfile changed without a manifest change. Check for silent upgrades.' });
  }
  const testHunks = hunks.filter((h) => TEST_PATH.test(h.path) && !h.whitespaceOnly);
  const codeHunks = hunks.filter((h) => !TEST_PATH.test(h.path) && !h.lockfile && !h.generated && !h.whitespaceOnly);
  if (codeHunks.length > 0 && testHunks.length === 0) {
    findings.push({ code: 'no-tests', severity: 'low', message: 'Code changed but no test files changed.' });
  }
  return findings;
}
