import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { CliError } from './errors.mjs';

/**
 * @param {string} [home]
 * @returns {string}
 */
export function zokuDir(home = os.homedir()) {
  return path.join(home, '.zoku');
}

/**
 * @param {string} [home]
 * @returns {string}
 */
export function credentialsPath(home = os.homedir()) {
  return path.join(zokuDir(home), 'credentials');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function apiBase(env = process.env) {
  const raw = env.ZOKU_API_BASE || 'https://cloud.heyzoku.com';
  return raw.replace(/\/+$/, '');
}

/**
 * @param {string} sessionId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function cloudSessionUrl(sessionId, env = process.env) {
  return `${apiBase(env)}/s/${sessionId}`;
}

/**
 * @param {string} [home]
 * @returns {Promise<string | null>}
 */
export async function loadToken(home = os.homedir()) {
  const file = credentialsPath(home);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return null;
    throw err;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new CliError('credentials file is invalid');
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string' && parsed.token) {
    return parsed.token;
  }
  throw new CliError('credentials file is invalid');
}

/**
 * @param {string} token
 * @param {string} [home]
 */
export async function saveToken(token, home = os.homedir()) {
  const dir = zokuDir(home);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = credentialsPath(home);
  await writeFile(file, `${JSON.stringify({ token }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(file, 0o600);
}

/**
 * @param {string} [home]
 */
export async function deleteToken(home = os.homedir()) {
  try {
    await unlink(credentialsPath(home));
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return;
    throw err;
  }
}

/**
 * @param {string} localSessionId
 * @param {{ cloudId: string, workBranch: string, repo: string }} link
 * @param {string} [home]
 */
export async function writeLink(localSessionId, link, home = os.homedir()) {
  const dir = path.join(zokuDir(home), 'links');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${localSessionId}.json`);
  await writeFile(file, `${JSON.stringify(link, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
