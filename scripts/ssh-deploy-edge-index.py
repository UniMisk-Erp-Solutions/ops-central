#!/usr/bin/env python3
"""Upload edge function index.ts and restart OPC edge container only."""
import os
import paramiko

HOST = "192.168.16.112"
USER = "mithilmistry"
PW = os.environ["SSH_PASSWORD"]
SID = "hws00sks44g8k04k8wccooco"
LOCAL = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "supabase", "functions", "main", "index.ts",
)
REMOTE_TMP = "/tmp/opc-main-index.ts"
REMOTE_DEST = f"/data/coolify/services/{SID}/volumes/functions/main/index.ts"
EDGE = f"supabase-edge-functions-{SID}"

def main():
    with open(LOCAL, encoding="utf-8") as f:
        content = f.read()

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=20)

    sftp = c.open_sftp()
    with sftp.file(REMOTE_TMP, "w") as rf:
        rf.write(content)
    sftp.close()
    print(f"Uploaded -> {REMOTE_TMP}")

    sp = PW.replace("'", "'\"'\"'")
    script = f"""
set -e
SUDO() {{ echo '{sp}' | sudo -S "$@"; }}
SUDO mkdir -p /data/coolify/services/{SID}/volumes/functions/main
SUDO cp {REMOTE_TMP} {REMOTE_DEST}
SUDO chmod 644 {REMOTE_DEST}
echo "=== index.ts on server ==="
SUDO head -5 {REMOTE_DEST}
echo "=== restart edge ==="
SUDO docker restart {EDGE}
sleep 4
SUDO docker ps --format '{{{{.Names}}}}\\t{{{{.Status}}}}' | grep edge-functions-{SID}
echo "=== curl edge ==="
curl -s http://127.0.0.1:54331/functions/v1/main || true
echo ""
curl -s -o /dev/null -w "HTTP %{{http_code}}\\n" http://127.0.0.1:54331/functions/v1/main
"""
    stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
    stdin.write(script)
    stdin.channel.shutdown_write()
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err.strip():
        print("stderr:", err[-1500:])
    c.close()

if __name__ == "__main__":
    main()
