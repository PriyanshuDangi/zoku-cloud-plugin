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
 * Pull human-typed prompt text from a JSONL user record (including slash XML).
 * @param {unknown} rec
 * @returns {string}
 */
function recordUserContent(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const msg = rec.message;
  if (!msg || typeof msg !== 'object') return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function isShareSlashRecord(rec) {
  const t = recordUserContent(rec);
  if (rec && rec.type === 'user') {
    if (/<command-name>\s*\/?zoku-cloud:share\s*<\/command-name>/i.test(t)) return true;
    if (/<command-message>\s*zoku-cloud:share\s*<\/command-message>/i.test(t)) return true;
    if (t.trim() === '/zoku-cloud:share' || t.trim().startsWith('/zoku-cloud:share ')) return true;
  }
  return false;
}

function isShareSkillRecord(rec) {
  if (!rec || rec.type !== 'user') return false;
  const t = recordUserContent(rec);
  return t.includes('/skills/share') && /scripts\/zoku/.test(t);
}

function isZokuShareBashCommand(command) {
  return /scripts\/zoku["'\s]/.test(command) && /\bshare\b/.test(command);
}

function shareToolUses(rec) {
  /** @type {string[]} */
  const toolIds = [];
  if (!rec || rec.type !== 'assistant' || !rec.message || typeof rec.message !== 'object') {
    return { toolIds, messageId: /** @type {string | null} */ (null) };
  }
  const inner = rec.message;
  const content = Array.isArray(inner.content) ? inner.content : [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'tool_use' || typeof block.id !== 'string') {
      continue;
    }
    const command =
      block.input && typeof block.input === 'object' && typeof block.input.command === 'string'
        ? block.input.command
        : '';
    if (isZokuShareBashCommand(command)) toolIds.push(block.id);
  }
  const messageId = typeof inner.id === 'string' ? inner.id : null;
  return { toolIds, messageId: toolIds.length > 0 ? messageId : null };
}

function resultToolIds(rec) {
  /** @type {string[]} */
  const ids = [];
  if (!rec || !rec.message || typeof rec.message !== 'object') return ids;
  const content = rec.message.content;
  if (!Array.isArray(content)) return ids;
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      ids.push(block.tool_use_id);
    }
  }
  return ids;
}

/**
 * Remove the in-flight /zoku-cloud:share turn so the sandbox resumes a
 * finished chat, not a hanging Bash tool_use.
 * @param {string} jsonlText
 * @returns {string}
 */
export function dropShareTurnsFromJsonl(jsonlText) {
  const lines = jsonlText.split('\n');
  /** @type {{ line: string, rec: object | null }[]} */
  const rows = lines.map((line) => {
    if (!line) return { line, rec: null };
    try {
      const rec = JSON.parse(line);
      return { line, rec: rec && typeof rec === 'object' ? rec : null };
    } catch {
      return { line, rec: null };
    }
  });

  const shareToolIds = new Set();
  const shareMessageIds = new Set();
  for (const row of rows) {
    if (!row.rec) continue;
    const { toolIds, messageId } = shareToolUses(row.rec);
    for (const id of toolIds) shareToolIds.add(id);
    if (messageId) shareMessageIds.add(messageId);
  }

  const kept = rows.filter((row) => {
    const rec = row.rec;
    if (!rec) return true;
    if (isShareSlashRecord(rec) || isShareSkillRecord(rec)) return false;
    const { toolIds, messageId } = shareToolUses(rec);
    if (toolIds.length > 0) return false;
    const mid = rec.message && typeof rec.message === 'object' && typeof rec.message.id === 'string' ? rec.message.id : null;
    if (mid && shareMessageIds.has(mid)) return false;
    if (messageId && shareMessageIds.has(messageId)) return false;
    const results = resultToolIds(rec);
    if (results.length > 0 && results.every((id) => shareToolIds.has(id))) return false;
    return true;
  });

  return kept.map((row) => row.line).join('\n');
}

/**
 * @param {string} jsonlText
 * @param {{ localCwd: string, sandboxCwd: string }} paths
 * @returns {{ text: string, title?: string, model?: string }}
 */
export function transformJsonl(jsonlText, paths) {
  const text = prepareJsonl(dropShareTurnsFromJsonl(jsonlText), paths);
  const { title, model } = extractTitleAndModel(text);
  return { text, title, model };
}
