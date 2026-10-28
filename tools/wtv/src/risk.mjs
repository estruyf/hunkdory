// Plain heuristics. Cheap, explainable, and good enough to decide reading order.

const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|[^/]+\.csproj|Directory\.Packages\.props)$/;
const CONFIG = /(^|\/)(\.github\/workflows\/|\.gitlab-ci|azure-pipelines|Dockerfile|docker-compose|\.env|\.npmrc|tsconfig[^/]*\.json$|[^/]+\.config\.[cm]?[jt]s$|vite\.config|webpack\.config|eslint|\.eslintrc|\.prettierrc|vercel\.json|netlify\.toml|wrangler\.toml|serverless\.ya?ml|host\.json|local\.settings\.json|appsettings[^/]*\.json)/;
// Security terms in two strengths. A strong one in code is high risk; a weak one ("session", "role") is a medium
// "worth a look". Comments don't count: a doc comment that says "role" is not a permission check.
const SECURITY_STRONG = /\b(auth(?!or)\w*|token\w*|secret\w*|passw(or)?d|credential\w*|jwt|cipher|encrypt\w*|decrypt\w*|csrf|cors|oauth|api[_-]?key|private[_-]?key)\b/i;
// role="button" is accessibility, not a permission.
const SECURITY_WEAK = /\b(session\w*|crypto(?!\.(randomUUID|getRandomValues)\b)|permission\w*|roles?(?!\s*=\s*["'{])|acl|sanitize\w*|expir\w*)\b/i;
const COMMENT = /^\s*(\/\/|\/\*|\*|#(\s|$)|<!--|\{\/\*)/;
// A bare exec( is a process; re.exec( is a regular expression.
const EXEC = /\b(child_process|execSync|(?<![.\w])exec\(|spawn\(|eval\(|new Function\(|subprocess|os\.system|Runtime\.getRuntime|Process\.Start|shell=True)|dangerouslySetInnerHTML|\.innerHTML\s*=/;
const NETWORK = /\bfetch\(|\baxios\b|http\.request|https\.request|XMLHttpRequest|WebSocket\(|https?:\/\/(?!localhost|127\.0\.0\.1|example\.(com|org))[\w.-]+/;
const SUPPRESS = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|#\s*noqa|#\s*type:\s*ignore|\bas any\b|:\s*any\b|#pragma warning disable|@SuppressWarnings|nolint/;
const SKIP_TEST = /\b(it|test|describe)\.(skip|only|todo)\(|\bx(it|describe|test)\(|@Ignore\b|@Disabled\b|pytest\.mark\.skip|\[Ignore\]|t\.Skip\(/;
const ASSERT = /\b(expect|assert\w*|should|toBe|toEqual|toMatch|toThrow|toHaveBeenCalled\w*|Assert\.\w+|require\.\w+)\b/;
const SWALLOW = /catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+\w+)?\s*:\s*pass\b|\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
const API_DECL = /^\s*(export\s|module\.exports|exports\.\w+\s*=|public\s|def\s+[a-zA-Z]|func\s+[A-Z])/;
const TODO = /\b(TODO|FIXME|HACK|XXX)\b/;
const DEP_LINE = /^\s*"[@\w./-]+"\s*:\s*"(?:[~^<>=*]|\d|workspace:|file:|link:|git|https?:|latest|next)/;
// package.json fields that look like a dependency ("version": "1.2.3") but aren't one.
const MANIFEST_FIELD = /^\s*"(name|version|description|private|main|module|types|typings|type|license|author|homepage|repository|bugs|keywords|packageManager)"\s*:/;

export const SEVERITY = { high: 3, medium: 2, low: 1, none: 0 };

/**
 * Where a pattern first shows up in a hunk: the matched text and its line (new file for added lines, old file
 * for removed ones). With `code`, comment lines are skipped. Null when it doesn't match.
 */
function locate(h, re, { code = false, side = 'both' } = {}) {
  const sides = [side !== 'removed' && [h.added, h.newStart], side !== 'added' && [h.removed, h.oldStart]].filter(Boolean);
  for (const [lines, start] of sides) {
    const text = lines.map((l) => (code && COMMENT.test(l) ? '' : l)).join('\n');
    const m = re.exec(text);
    if (m) return { term: m[0].trim().slice(0, 60), line: start + (text.slice(0, m.index).match(/\n/g)?.length ?? 0) };
  }
  return null;
}

/** The first whole line that passes `test`, as a match. */
function locateLine(h, test) {
  for (const [lines, start] of [[h.added, h.newStart], [h.removed, h.oldStart]]) {
    const i = lines.findIndex(test);
    if (i >= 0) return { term: lines[i].trim().slice(0, 60), line: start + i };
  }
  return null;
}

export function assessHunk(h) {
  if (h.whitespaceOnly) return { risks: [], level: 'none' };
  const risks = [];
  // `match` says why: the text that set the tag off, and its line (null for a match on the path).
  const add = (code, severity, label, match = null) => risks.push({ code, severity, label, ...(match ? { match } : {}) });
  const added = h.added.join('\n');
  const isTest = TEST_PATH.test(h.path);

  if (h.lockfile) add('lockfile', 'low', 'Lockfile changed');

  if (MANIFEST.test(h.path)) {
    const isDep = (l) => DEP_LINE.test(l) && !MANIFEST_FIELD.test(l);
    if (!h.path.endsWith('package.json')) add('deps', 'high', 'Dependency change');
    else if ([...h.added, ...h.removed].some(isDep)) add('deps', 'high', 'Dependency change', locateLine(h, isDep));
    else if ([...h.added, ...h.removed].some((l) => /^\s*"version"\s*:/.test(l))) add('version', 'low', 'Version bumped', locate(h, /"version"\s*:\s*"[^"]*"/, { side: 'added' }));
  }

  if (isTest) {
    const lostAsserts = h.removed.filter((l) => ASSERT.test(l)).length - h.added.filter((l) => ASSERT.test(l)).length;
    if (h.status === 'deleted') add('tests-weakened', 'high', 'Test file deleted');
    else if (lostAsserts > 0) add('tests-weakened', 'high', `Lost ${lostAsserts} assertion${lostAsserts > 1 ? 's' : ''}`);
    if (SKIP_TEST.test(added)) add('tests-weakened', 'high', 'Test skipped or focused');
  }

  if (!isTest) {
    const onPath = (re) => re.exec(h.path) && { term: re.exec(h.path)[0], line: null };
    const strong = onPath(SECURITY_STRONG) ?? locate(h, SECURITY_STRONG, { code: true });
    const weak = !strong && (onPath(SECURITY_WEAK) ?? locate(h, SECURITY_WEAK, { code: true }));
    if (strong) add('security', 'high', 'Touches auth or security', strong);
    else if (weak) add('security', 'medium', 'Mentions sessions, roles or permissions', weak);
  }
  if (EXEC.test(added)) add('exec', 'high', 'Code execution or raw HTML', locate(h, EXEC, { side: 'added' }));
  if (CONFIG.test(h.path)) add('config', 'medium', 'Build, CI or runtime config');
  if (!isTest && NETWORK.test(added)) add('network', 'medium', 'New network call or URL', locate(h, NETWORK, { side: 'added' }));
  if (SUPPRESS.test(added)) add('suppression', 'medium', 'Lint or type check suppressed', locate(h, SUPPRESS, { side: 'added' }));
  if (SWALLOW.test(added)) add('swallowed-error', 'medium', 'Error swallowed', locate(h, SWALLOW, { side: 'added' }));
  if (!isTest && h.removed.some((l) => API_DECL.test(l))) add('api', 'medium', 'Public API changed or removed');
  if (h.status === 'deleted' && !isTest) add('deleted', 'medium', 'File deleted');
  if (h.synthetic === 'binary') add('binary', 'medium', 'Binary file changed');
  if (TODO.test(added)) add('todo', 'low', 'New TODO or FIXME', locate(h, TODO, { side: 'added' }));
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
