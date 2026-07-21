#!/usr/bin/env python3
"""Deploy the RFQ edge function to the SO-PO Supabase edge runtime — SO-PO ONLY.

Writes supabase/functions/main/index.ts into the Coolify functions volume and
restarts ONLY the SO-PO edge container. If BREVO_API_KEY is set in the runner's
env, also writes /main/_secrets.json (Brevo config) — so the key never goes
through source or chat. Touches no other project/stack.

Deploy code only:   SSH_PASSWORD='...' python scripts/ssh-deploy-rfq-edge.py
With Brevo secret:  SSH_PASSWORD='...' BREVO_API_KEY='xkeysib-...' \
                    SENDER_EMAIL='info@unimisk.com' SENDER_NAME='Unimisk' \
                    python scripts/ssh-deploy-rfq-edge.py
"""
import base64, json, os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = "spfohj2m4ij61p4riaup006i"
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

idx_b64 = base64.b64encode(open("supabase/functions/main/index.ts", "rb").read()).decode()

# Optional Brevo secrets from the runner's env (never hardcoded).
secrets = {}
for k in ("BREVO_API_KEY", "SENDER_EMAIL", "SENDER_NAME", "QUOTE_BASE_URL"):
    if os.environ.get(k):
        secrets[k] = os.environ[k]
secrets_b64 = base64.b64encode(json.dumps(secrets).encode()).decode() if secrets else ""

sp = PW.replace("'", "'\"'\"'")
write_secrets = ""
if secrets_b64:
    write_secrets = (
        "echo '=== write _secrets.json (Brevo) ==='\n"
        f"echo '{secrets_b64}' | base64 -d > /tmp/_secrets.json\n"
        'SUDO cp /tmp/_secrets.json "$FNDIR/_secrets.json" && SUDO chmod 600 "$FNDIR/_secrets.json" && echo "wrote _secrets.json ($(SUDO wc -c < "$FNDIR/_secrets.json") bytes)"\n'
        "rm -f /tmp/_secrets.json\n"
    )

script = f"""#!/bin/bash
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
SID={SID}
EF="supabase-edge-functions-$SID"
FNDIR="/data/coolify/services/$SID/volumes/functions/main"
echo "=== write main/index.ts ==="
echo '{idx_b64}' | base64 -d > /tmp/rfq_index.ts
SUDO cp /tmp/rfq_index.ts "$FNDIR/index.ts" && echo "wrote index.ts ($(SUDO wc -c < "$FNDIR/index.ts") bytes)"
rm -f /tmp/rfq_index.ts
{write_secrets}echo "=== restart SO-PO edge container only ==="
SUDO docker restart "$EF" >/dev/null 2>&1 && echo "restarted $EF"
echo "=== wait for health ==="
for i in $(seq 1 20); do
  h=$(SUDO docker inspect -f '{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{else}}}}{{{{.State.Status}}}}{{{{end}}}}' "$EF" 2>/dev/null)
  if [ "$h" = "healthy" ] || [ "$h" = "running" ]; then echo "edge: $h"; break; fi
  sleep 2
done
echo "=== internal health probe ==="
SUDO docker exec "$EF" sh -c 'command -v curl >/dev/null && curl -s -m 5 http://localhost:9000/main/health || echo "(no curl in container)"' 2>&1 | head -3
echo DONE
"""

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PW, timeout=30)
i, o, e = cli.exec_command("bash -s", timeout=120)
i.write(script); i.channel.shutdown_write()
out = o.read().decode("utf-8", "replace")
err = e.read().decode("utf-8", "replace")
cli.close()
if err.strip():
    out += "\n--- stderr ---\n" + err
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout.buffer.write(out.encode("utf-8", "replace"))
