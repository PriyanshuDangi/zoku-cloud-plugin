import { apiBase } from './config.mjs';
import { CliError, safeErrorText } from './errors.mjs';

/**
 * @typedef {object} ApiJsonResult
 * @property {boolean} ok
 * @property {number} status
 * @property {Record<string, unknown> | null} json
 */

/**
 * JSON request to Zoku Cloud. Never logs Authorization or bodies.
 *
 * @param {string} method
 * @param {string} pathname
 * @param {object} [opts]
 * @param {string} [opts.token]
 * @param {unknown} [opts.body]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<ApiJsonResult>}
 */
export async function requestJson(method, pathname, opts = {}) {
  const headers = { accept: 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${apiBase(opts.env)}${pathname}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new CliError(safeErrorText(err));
  }
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') json = parsed;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * @param {ApiJsonResult} res
 * @returns {string}
 */
export function apiErrorMessage(res) {
  const err = res.json && typeof res.json.error === 'string' ? res.json.error : '';
  if (err === 'missing_credentials') {
    return 'missing credentials — add keys in Zoku Cloud Settings';
  }
  if (err) return err;
  return `request failed (${res.status})`;
}

/**
 * PUT gzip to the sandbox seed URL. Caller owns retries; this function does
 * not print or return the bearer.
 *
 * @param {string} seedUrl
 * @param {string} seedToken
 * @param {Buffer} gzip
 * @returns {Promise<{ status: number, error: string }>}
 */
export async function putGzip(seedUrl, seedToken, gzip) {
  let res;
  try {
    res = await fetch(seedUrl, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${seedToken}`,
        'content-type': 'application/gzip',
      },
      body: gzip,
    });
  } catch (err) {
    throw new CliError(safeErrorText(err));
  }
  const text = await res.text();
  return { status: res.status, error: seedErrorFromBody(text) };
}

/**
 * Bridge `/seed` speaks plain text (`repo_not_ready`). Web JSON uses `{ error }`.
 *
 * @param {string} text
 * @returns {string}
 */
export function seedErrorFromBody(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // plain-text codes from the sandbox
  }
  const first = trimmed.split(/\s/)[0];
  return first || trimmed;
}

/**
 * @param {ApiJsonResult} res
 * @param {string} fallback
 * @returns {never}
 */
export function throwApi(res, fallback) {
  throw new CliError(apiErrorMessage(res) || fallback);
}
