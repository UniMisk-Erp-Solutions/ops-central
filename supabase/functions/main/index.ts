// Supabase Edge — Deno runtime (no Node packages)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  let path = url.pathname;
  for (const p of ["/functions/v1/main", "/main"]) {
    if (path === p) path = "/";
    else if (path.startsWith(p + "/")) path = path.slice(p.length) || "/";
  }

  if (path === "/" || path === "/health") {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "op-central-api",
        runtime: "supabase-edge",
        path,
      }),
      { headers: cors },
    );
  }

  return new Response(JSON.stringify({ ok: false, error: "Not found", path }), {
    status: 404,
    headers: cors,
  });
});
