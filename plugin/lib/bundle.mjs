import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { MAX_COMPRESSED_BYTES, MAX_MANIFEST_BYTES } from './limits.mjs';

const execFile = promisify(execFileCb);

/**
 * @typedef {object} BundleManifest
 * @property {1} v
 * @property {string} resumeId
 * @property {string} localCwd
 * @property {string} sandboxCwd
 * @property {number} jsonlBytes
 * @property {number} patchBytes
 * @property {string} headSha
 */

/**
 * Write the three root entries, then `tar -czf` (argv, never a shell string).
 *
 * @param {object} opts
 * @param {string} opts.dir  temp dir that will hold the three files
 * @param {string} opts.outFile
 * @param {BundleManifest} opts.manifest
 * @param {string} opts.jsonl
 * @param {Buffer} opts.patch
 * @returns {Promise<Buffer>}
 */
export async function packSeedBundle(opts) {
  const manifestText = `${JSON.stringify(opts.manifest)}\n`;
  const manifestBuf = Buffer.from(manifestText, 'utf8');
  if (manifestBuf.length > MAX_MANIFEST_BYTES) {
    throw new CliError('manifest.json exceeds 64KiB');
  }

  await writeFile(path.join(opts.dir, 'manifest.json'), manifestBuf);
  await writeFile(path.join(opts.dir, 'session.jsonl'), opts.jsonl, 'utf8');
  await writeFile(path.join(opts.dir, 'dirty.patch'), opts.patch);

  await execFile(
    'tar',
    [
      '--format=ustar',
      '-czf',
      opts.outFile,
      '-C',
      opts.dir,
      'manifest.json',
      'session.jsonl',
      'dirty.patch',
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );

  const st = await stat(opts.outFile);
  if (st.size > MAX_COMPRESSED_BYTES) {
    throw new CliError('compressed bundle exceeds 32MiB');
  }
  return readFile(opts.outFile);
}
