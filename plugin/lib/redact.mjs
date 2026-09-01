const SECRET_RE = /sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|e2b_[A-Za-z0-9_]+/g;

/**
 * Rough redaction of common credential prefixes in JSONL / patches / errors.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return text.replace(SECRET_RE, '[redacted]');
}

/**
 * Rewrite laptop cwd bytes to the sandbox repo dir. Skips trivially short paths
 * so a cwd of `/` cannot rewrite the whole file.
 *
 * @param {string} text
 * @param {string} localCwd
 * @param {string} sandboxCwd
 * @returns {string}
 */
export function rewriteLocalCwd(text, localCwd, sandboxCwd) {
  const from = trimTrailingSlash(localCwd);
  const to = trimTrailingSlash(sandboxCwd);
  if (from.length < 2 || from === to) return text;
  return text.split(from).join(to);
}

/**
 * @param {string} text
 * @param {{ localCwd: string, sandboxCwd: string }} paths
 * @returns {string}
 */
export function prepareJsonl(text, paths) {
  return rewriteLocalCwd(redactSecrets(text), paths.localCwd, paths.sandboxCwd);
}

/**
 * @param {string} p
 * @returns {string}
 */
function trimTrailingSlash(p) {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}
