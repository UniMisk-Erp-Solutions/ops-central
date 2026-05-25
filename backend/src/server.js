/**
 * Node.js dev server — same API as Supabase Edge function "main".
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { handleRequest } from './handler.mjs';

const PORT = Number(process.env.API_PORT || 3001);
const HOST = process.env.API_HOST || '0.0.0.0';

function nodeRequestToFetch(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `http://${host}${req.url || '/'}`;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      resolve(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        }),
      );
    });
    req.on('error', reject);
  });
}

async function fetchToNodeResponse(fetchRes, res) {
  res.statusCode = fetchRes.status;
  fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await fetchRes.arrayBuffer());
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const fetchReq = await nodeRequestToFetch(req);
    const fetchRes = await handleRequest(fetchReq, process.env);
    await fetchToNodeResponse(fetchRes, res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OP Central API (Node) http://${HOST}:${PORT}`);
  console.log(`  health → http://127.0.0.1:${PORT}/health`);
  console.log(`  status → http://127.0.0.1:${PORT}/api/status`);
  console.log(`  Supabase → ${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '(not set)'}`);
});
