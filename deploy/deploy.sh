#!/bin/bash
# Copies the app to the server and restarts it.
# Usage: deploy/deploy.sh <host>   (needs ssh access as ec2-user)
set -euo pipefail
HOST=${1:?usage: deploy/deploy.sh <host>}
SSH="ssh -i ${SSH_KEY:-$HOME/.ssh/otr.pem} -o StrictHostKeyChecking=accept-new"
cd "$(dirname "$0")/.."

rsync -az --delete -e "$SSH" \
  --exclude .git --exclude node_modules --exclude data --exclude test --exclude '*.md' \
  ./ "ec2-user@$HOST:/opt/otr/"

$SSH "ec2-user@$HOST" bash -s <<'EOF'
set -euo pipefail
cd /opt/otr
/usr/local/bin/npm ci --omit=dev --silent
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo install -m 644 deploy/otr.service /etc/systemd/system/otr.service
sudo install -m 644 deploy/caddy.service /etc/systemd/system/caddy.service
if [ ! -f /etc/otr.env ]; then echo "Missing /etc/otr.env (FACILITATOR_TOKEN, ANTHROPIC_API_KEY)"; exit 1; fi
sudo systemctl daemon-reload
sudo systemctl enable --now caddy otr
sudo systemctl restart otr
sudo systemctl reload caddy || sudo systemctl restart caddy
systemctl is-active otr caddy
EOF
