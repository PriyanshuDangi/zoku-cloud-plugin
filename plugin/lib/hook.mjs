import path from 'node:path';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Persist session id for later `zoku share`. Must not throw to the hook wrapper.
 *
 * @param {Record<string, unknown>} input
 * @param {NodeJS.ProcessEnv} env
 * @param {object} [io]
 * @param {typeof readFile} [io.readFile]
 * @param {typeof writeFile} [io.writeFile]
 * @param {typeof mkdir} [io.mkdir]
 * @param {typeof appendFile} [io.appendFile]
 */
export async function applySessionHook(input, env, io = {}) {
  const read = io.readFile ?? readFile;
  const write = io.writeFile ?? writeFile;
  const mk = io.mkdir ?? mkdir;
  const append = io.appendFile ?? appendFile;

  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  if (!sessionId) return;

  const envFile = env.CLAUDE_ENV_FILE;
  if (envFile) {
    let existing = '';
    try {
      existing = await read(envFile, 'utf8');
    } catch (err) {
      if (!(err && typeof err === 'object' && err.code === 'ENOENT')) throw err;
    }
    if (!/(?:^|\n)\s*export\s+CLAUDE_CODE_SESSION_ID=/.test(existing)) {
      const block =
        `export CLAUDE_CODE_SESSION_ID=${shSingleQuote(sessionId)}\n` +
        `export CLAUDE_TRANSCRIPT_PATH=${shSingleQuote(transcriptPath)}\n`;
      await append(envFile, block, 'utf8');
    }
  }

  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    await mk(pluginData, { recursive: true });
    const payload = {
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
    };
    await write(path.join(pluginData, 'last-session.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function shSingleQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
