#!/usr/bin/env node
/**
 * Deploy edge function "main" to ONE Coolify Supabase service only.
 * Usage: SSH_PASSWORD=xxx node scripts/deploy-edge-function.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.SSH_HOST || '192.168.16.112';
const USER = process.env.SSH_USER || 'mithilmistry';
const SERVER = `${USER}@${HOST}`;
const PASSWORD = process.env.SSH_PASSWORD;
const SERVICE_ID = process.env.SUPABASE_SERVICE_ID || 'hws00sks44g8k04k8wccooco';
const REMOTE_DIR = `/data/coolify/services/${SERVICE_ID}/volumes/functions/main`;
const EDGE_CONTAINER = `supabase-edge-functions-${SERVICE_ID}`;

if (!PASSWORD) {
  console.error('Set SSH_PASSWORD (do not commit passwords to git).');
  process.exit(1);
}

execSync('node scripts/sync-edge-function.mjs', { cwd: root, stdio: 'inherit' });

const fnDir = path.join(root, 'supabase/functions/main');
const files = ['index.ts', 'handler.mjs', 'lib/supabase.mjs'];
const tmp = '/tmp/opc-edge-main';

for (const f of files) {
  const local = path.join(fnDir, f);
  if (!fs.existsSync(local)) {
    console.error('Missing', local);
    process.exit(1);
  }
}

try {
  execSync(`ssh -o StrictHostKeyChecking=no ${SERVER} "mkdir -p ${tmp}/lib"`, { stdio: 'inherit' });
} catch {
  console.error('SSH failed. Test: ssh', SERVER);
  process.exit(1);
}

for (const f of files) {
  const local = path.join(fnDir, f);
  const remote = f.includes('/') ? `${tmp}/lib/supabase.mjs` : `${tmp}/${path.basename(f)}`;
  execSync(`scp "${local}" "${SERVER}:${remote}"`, { stdio: 'inherit' });
}

const remoteScript = `
echo '${PASSWORD.replace(/'/g, "'\"'\"'")}' | sudo -S mkdir -p "${REMOTE_DIR}/lib"
echo '${PASSWORD.replace(/'/g, "'\"'\"'")}' | sudo -S cp ${tmp}/index.ts ${tmp}/handler.mjs "${REMOTE_DIR}/"
echo '${PASSWORD.replace(/'/g, "'\"'\"'")}' | sudo -S cp ${tmp}/lib/supabase.mjs "${REMOTE_DIR}/lib/"
echo '${PASSWORD.replace(/'/g, "'\"'\"'")}' | sudo -S docker restart ${EDGE_CONTAINER} 2>/dev/null || true
sleep 2
curl -s -o /dev/null -w "edge %{http_code}\\n" http://127.0.0.1:54331/functions/v1/main
`;

execSync(`ssh -o StrictHostKeyChecking=no ${SERVER} "${remoteScript.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });
console.log(`\nTest: http://${HOST}:54331/functions/v1/main`);
