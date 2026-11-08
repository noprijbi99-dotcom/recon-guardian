// Stage-1 smoke test: prove the Sandbox credentials work by fetching an
// OAuth token. Prints ONLY status facts — never the token, never secrets.
import { getAccessToken } from './client.mjs';
import { paypalConfig } from '../config.mjs';

const cfg = paypalConfig();
console.log(`env=${cfg.env} base=${cfg.base} configured=${cfg.ready}`);
try {
  const t = await getAccessToken();
  console.log(`TOKEN_OK length=${t.length} (value not shown)`);
} catch (e) {
  console.log(`TOKEN_FAIL ${e.message}`);
  process.exitCode = 1;
}
