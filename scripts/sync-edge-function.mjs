#!/usr/bin/env node
/** Copy shared Node handler into supabase/functions/main for edge deploy */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'backend/src/handler.mjs');
const lib = path.join(root, 'backend/src/lib/supabase.mjs');
const destDir = path.join(root, 'supabase/functions/main');
const destLib = path.join(destDir, 'lib');

fs.mkdirSync(destLib, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'handler.mjs'));
fs.copyFileSync(lib, path.join(destLib, 'supabase.mjs'));
console.log('Synced handler.mjs → supabase/functions/main/');
