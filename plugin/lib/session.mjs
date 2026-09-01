import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { CliError } from './errors.mjs';
import { claudeProjectSlug } from './slug.mjs';
import { MAX_JSONL_BYTES } from './limits.mjs';

/**
 * @typedef {object} ResolvedSession
 * @property {string} sessionId
 * @property {string} transcriptPath
 */

/**
 * Resolve the local Claude Code session to fork.
 * Order: --session-id, CLAUDE_CODE_SESSION_ID, last-session.json, newest matching jsonl.
 *
 * @param {object} opts
 * @param {string} [opts.sessionId]
 * @param {string} opts.cwd
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homedir]
 * @returns {Promise<ResolvedSession>}
 */
export async function resolveShareSession(opts) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd;
  const homedir = opts.homedir ?? os.homedir();
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude');

  if (opts.sessionId) {
    return withTranscript(opts.sessionId, undefined, cwd, configDir);
  }
  if (env.CLAUDE_CODE_SESSION_ID) {
    return withTranscript(env.CLAUDE_CODE_SESSION_ID, env.CLAUDE_TRANSCRIPT_PATH, cwd, configDir);
  }

  const last = await readLastSession(env.CLAUDE_PLUGIN_DATA);
  if (last?.sessionId) {
    return withTranscript(last.sessionId, last.transcriptPath || env.CLAUDE_TRANSCRIPT_PATH, cwd, configDir);
  }

  return findNewestMatchingJsonl(cwd, configDir);
}

/**
 * @param {string | undefined} pluginData
 * @returns {Promise<{ sessionId: string, transcriptPath?: string } | null>}
 */
export async function readLastSession(pluginData) {
  if (!pluginData) return null;
  const file = path.join(pluginData, 'last-session.json');
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : '';
  if (!sessionId) return null;
  const transcriptPath =
    typeof parsed.transcript_path === 'string' ? parsed.transcript_path : undefined;
  return { sessionId, transcriptPath };
}

/**
 * @param {string} sessionId
 * @param {string | undefined} transcriptPath
 * @param {string} cwd
 * @param {string} configDir
 * @returns {Promise<ResolvedSession>}
 */
async function withTranscript(sessionId, transcriptPath, cwd, configDir) {
  if (transcriptPath) {
    await assertJsonlFile(transcriptPath);
    return { sessionId, transcriptPath };
  }
  const guessed = path.join(configDir, 'projects', claudeProjectSlug(cwd), `${sessionId}.jsonl`);
  await assertJsonlFile(guessed);
  return { sessionId, transcriptPath: guessed };
}

/**
 * @param {string} file
 */
async function assertJsonlFile(file) {
  let st;
  try {
    st = await stat(file);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      throw new CliError('could not find a local Claude Code session transcript');
    }
    throw err;
  }
  if (!st.isFile()) {
    throw new CliError('could not find a local Claude Code session transcript');
  }
  if (st.size > MAX_JSONL_BYTES) {
    throw new CliError('session jsonl exceeds 48MiB');
  }
}

/**
 * @param {string} cwd
 * @param {string} configDir
 * @returns {Promise<ResolvedSession>}
 */
async function findNewestMatchingJsonl(cwd, configDir) {
  const dir = path.join(configDir, 'projects', claudeProjectSlug(cwd));
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      throw new CliError('could not find a local Claude Code session');
    }
    throw err;
  }

  /** @type {{ full: string, sessionId: string, mtime: number }[]} */
  const files = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_JSONL_BYTES) continue;
    files.push({ full, sessionId: name.slice(0, -'.jsonl'.length), mtime: st.mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);

  for (const file of files) {
    if (await fileCwdMatches(file.full, cwd)) {
      return { sessionId: file.sessionId, transcriptPath: file.full };
    }
  }
  throw new CliError('could not find a local Claude Code session whose cwd matches this directory');
}

/**
 * @param {string} file
 * @param {string} cwd
 */
async function fileCwdMatches(file, cwd) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.cwd === 'string' && rec.cwd === cwd) return true;
      } catch {
        continue;
      }
    }
  } finally {
    rl.close();
  }
  return false;
}
