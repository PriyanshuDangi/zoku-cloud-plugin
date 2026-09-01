import { deleteToken, loadToken, saveToken } from './config.mjs';
import { CliError } from './errors.mjs';
import { requestJson, throwApi } from './http.mjs';

/**
 * Device-code login. Prints verification_url + user_code; never prints device_code or token.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homedir]
 * @param {(line: string) => void} [opts.log]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 */
export async function runLogin(opts = {}) {
  const env = opts.env ?? process.env;
  const homedir = opts.homedir;
  const log = opts.log ?? ((line) => console.log(line));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const started = await requestJson('POST', '/api/cli/device', { env, body: {} });
  if (!started.ok || !started.json) {
    throw new CliError(started.json && typeof started.json.error === 'string' ? started.json.error : 'device login failed');
  }

  const userCode = typeof started.json.user_code === 'string' ? started.json.user_code : '';
  const deviceCode = typeof started.json.device_code === 'string' ? started.json.device_code : '';
  const verificationUrl =
    typeof started.json.verification_url === 'string' ? started.json.verification_url : '';
  if (!userCode || !deviceCode || !verificationUrl) {
    throw new CliError('device login returned an incomplete challenge');
  }

  log('');
  log('Visit this URL to authorize the Zoku Cloud CLI:');
  log('');
  log(`  ${verificationUrl}`);
  log('');
  log('Then enter this code:');
  log('');
  log(`  ${userCode}`);
  log('');
  log('Waiting for approval…');

  const intervalSec =
    typeof started.json.interval === 'number' && started.json.interval > 0
      ? started.json.interval
      : 5;
  const expiresSec =
    typeof started.json.expires_in === 'number' && started.json.expires_in > 0
      ? started.json.expires_in
      : 900;

  let intervalMs = intervalSec * 1000;
  const deadline = Date.now() + expiresSec * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const polled = await requestJson('POST', '/api/cli/device/token', {
      env,
      body: { device_code: deviceCode },
    });
    const json = polled.json;
    const err = json && typeof json.error === 'string' ? json.error : '';
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    if (err === 'expired_token' || err === 'access_denied') {
      throw new CliError(err === 'access_denied' ? 'authorization denied' : 'device code expired');
    }
    const token = json && typeof json.token === 'string' ? json.token : '';
    if (token) {
      await saveToken(token, homedir);
      log('Logged in.');
      return;
    }
    if (!polled.ok) {
      throw new CliError(err || `login poll failed (${polled.status})`);
    }
  }
  throw new CliError('device code expired');
}

/**
 * Revoke this CLI token on the server, then delete `~/.zoku/credentials`.
 * Cookie sessions are not affected. 401 (already gone) still clears the file.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.homedir]
 * @param {(line: string) => void} [opts.log]
 */
export async function runLogout(opts = {}) {
  const env = opts.env ?? process.env;
  const homedir = opts.homedir;
  const log = opts.log ?? ((line) => console.log(line));

  let token = null;
  try {
    token = await loadToken(homedir);
  } catch {
    token = null;
  }

  if (token) {
    const res = await requestJson('POST', '/api/cli/logout', { env, token });
    if (!res.ok && res.status !== 401) {
      throwApi(res, 'logout failed');
    }
  }

  await deleteToken(homedir);
  log('Logged out.');
}
