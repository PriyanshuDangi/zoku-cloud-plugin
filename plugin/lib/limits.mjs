export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_JSONL_BYTES = 48 * 1024 * 1024;
export const MAX_PATCH_BYTES = 16 * 1024 * 1024;
export const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;

/**
 * Safe git branch for share: the laptop's current branch, not a minted
 * `zoku/<hex>` fork. Keep in sync with web/lib/cli-token.ts `isCliWorkBranch`.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isWorkBranch(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > 200) return false;
  if (value === 'HEAD') return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('..') || value.includes('@{') || value.includes('//')) return false;
  if (value.endsWith('.lock') || value.endsWith('.')) return false;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]|\/(?=[A-Za-z0-9]))*$/.test(value)) return false;
  for (const part of value.split('/')) {
    if (!part || part.startsWith('.') || part.endsWith('.lock')) return false;
  }
  return true;
}
