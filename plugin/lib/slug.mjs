const MAX_ENCODED_LEN = 200;

/**
 * Claude Code project-directory slug. Do not realpath — symlink spelling is the key.
 * Every non [a-zA-Z0-9] UTF-16 code unit becomes exactly one `-`.
 * Paths whose slug is longer than 200 chars are truncated and suffixed with a
 * base-36 |int32 djb2| hash of the original path (Claude Code ≥ 2.1.177).
 *
 * @param {string} absPath
 * @returns {string}
 */
export function claudeProjectSlug(absPath) {
  const replaced = absPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (replaced.length <= MAX_ENCODED_LEN) return replaced;
  return `${replaced.slice(0, MAX_ENCODED_LEN)}-${pathHash(absPath)}`;
}

/**
 * JS: `((h<<5) - h + s.charCodeAt(i)) | 0` then `Math.abs(h).toString(36)`.
 * @param {string} s
 * @returns {string}
 */
function pathHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
