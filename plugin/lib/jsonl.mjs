import { prepareJsonl } from './redact.mjs';

/**
 * @param {unknown} rec
 * @returns {string | null}
 */
function userText(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const row = /** @type {Record<string, unknown>} */ (rec);
  if (row.isMeta === true) return null;
  const msg = row.message;
  if (!msg || typeof msg !== 'object') return null;
  const content = /** @type {Record<string, unknown>} */ (msg).content;
  if (typeof content === 'string') {
    if (content.includes('<command-name>') || content.includes('tool_result')) return null;
    const trimmed = content.trim();
    return trimmed || null;
  }
  if (!Array.isArray(content)) return null;
  if (
    content.some(
      (part) =>
        part &&
        typeof part === 'object' &&
        (part.type === 'tool_result' || part.type === 'tool_use'),
    )
  ) {
    return null;
  }
  const text = content
    .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  const trimmed = text.trim();
  return trimmed || null;
}

/**
 * First-line title, same shape as the dashboard helper (60 chars, word cut).
 * @param {string} prompt
 * @returns {string | undefined}
 */
export function summarizeTitle(prompt) {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine.replace(/\s+/g, ' ');
  if (!cleaned) return undefined;
  if (cleaned.length <= 60) return cleaned;
  const clipped = cleaned.slice(0, 60);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 30 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * @param {string} jsonlText
 * @returns {{ title?: string, model?: string }}
 */
export function extractTitleAndModel(jsonlText) {
  /** @type {string | undefined} */
  let title;
  /** @type {string | undefined} */
  let model;
  for (const line of jsonlText.split('\n')) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!title && rec && rec.type === 'user') {
      const t = userText(rec);
      if (t) title = summarizeTitle(t);
    }
    if (!model && rec && typeof rec.model === 'string' && rec.model) {
      model = rec.model;
    }
    if (
      !model &&
      rec &&
      rec.message &&
      typeof rec.message === 'object' &&
      typeof rec.message.model === 'string' &&
      rec.message.model
    ) {
      model = rec.message.model;
    }
  }
  return { title, model };
}

/**
 * @param {string} jsonlText
 * @param {string} cwd
 * @returns {boolean}
 */
export function jsonlCwdMatches(jsonlText, cwd) {
  for (const line of jsonlText.split('\n')) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.cwd === 'string' && rec.cwd === cwd) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * @param {string} jsonlText
 * @param {{ localCwd: string, sandboxCwd: string }} paths
 * @returns {{ text: string, title?: string, model?: string }}
 */
export function transformJsonl(jsonlText, paths) {
  const text = prepareJsonl(jsonlText, paths);
  const { title, model } = extractTitleAndModel(text);
  return { text, title, model };
}
