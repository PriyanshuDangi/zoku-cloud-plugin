import { CliError } from './errors.mjs';

/**
 * @typedef {object} SeedPutResult
 * @property {number} status
 * @property {string} [error]
 */

/**
 * PUT the gzip seed. 503 repo_not_ready retries the same token (~120s).
 * 409 after consume reseeds, then PUT with the new token. Never logs tokens.
 *
 * @param {object} opts
 * @param {string} opts.seedUrl
 * @param {string} opts.seedToken
 * @param {Buffer} opts.gzip
 * @param {string} opts.sessionId
 * @param {(url: string, token: string, gzip: Buffer) => Promise<SeedPutResult>} opts.put
 * @param {() => Promise<{ seedToken: string, seedUrl?: string }>} opts.reseed
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {number} [opts.repoWaitMs]
 * @param {number} [opts.maxReseeds]
 */
export async function uploadSeed(opts) {
  const sleep = opts.sleep ?? defaultSleep;
  const repoWaitMs = opts.repoWaitMs ?? 120_000;
  const maxReseeds = opts.maxReseeds ?? 2;

  let seedUrl = opts.seedUrl;
  let seedToken = opts.seedToken;
  let reseeds = 0;
  let delay = 1000;
  const started = Date.now();

  for (;;) {
    let result;
    try {
      result = await opts.put(seedUrl, seedToken, opts.gzip);
    } catch (err) {
      if (Date.now() - started < repoWaitMs) {
        await sleep(delay);
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      throw err instanceof Error ? err : new CliError('seed upload failed');
    }

    if (result.status >= 200 && result.status < 300) return;
    // Successful seed 404s further PUTs; share() then polls until running.
    if (result.status === 404) return;

    if (result.status === 400 || result.status === 413) {
      throw new CliError(result.error || `seed rejected (${result.status})`);
    }

    if (retrySameToken(result) && Date.now() - started < repoWaitMs) {
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
      continue;
    }

    if (shouldReseed(result) && reseeds < maxReseeds) {
      const next = await opts.reseed();
      if (!next.seedToken) throw new CliError('reseed did not return a token');
      seedToken = next.seedToken;
      if (next.seedUrl) seedUrl = next.seedUrl;
      reseeds += 1;
      continue;
    }

    // Apply/persist already reseeds. Finalize 5xx leaves the seed on disk;
    // the CLI polls GET until running while the bridge retries finalize.
    if (result.status >= 500 && result.status < 600) return;

    throw new CliError(result.error || `seed failed (${result.status})`);
  }
}

/**
 * @param {SeedPutResult} result
 */
function retrySameToken(result) {
  if (result.status === 503 && result.error === 'repo_not_ready') return true;
  if (result.status === 409 && result.error === 'seed_in_progress') return true;
  return false;
}

/**
 * @param {SeedPutResult} result
 */
function shouldReseed(result) {
  if (result.status === 500) {
    return result.error === 'apply_failed' || result.error === 'persist_failed';
  }
  if (result.status !== 409) return false;
  return result.error === 'seed_consumed' || result.error === 'seed_expired';
}

/**
 * @param {number} ms
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
