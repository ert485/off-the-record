#!/bin/bash
# EC2 user data for Amazon Linux 2023 (arm64). Installs Node and Caddy from
# their official release tarballs and keeps the system journal in memory only.
set -euo pipefail

NODE_VERSION=22.23.5
CADDY_VERSION=2.11.9

# Journal in RAM only: nothing survives a reboot or the instance's termination.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\n' > /etc/systemd/journald.conf.d/volatile.conf
systemctl restart systemd-journald
rm -rf /var/log/journal

dnf install -y tar xz rsync

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" | tar -xJ -C /usr/local --strip-components=1

curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_arm64.tar.gz" | tar -xz -C /usr/local/bin caddy
useradd --system --home /var/lib/caddy --create-home --shell /sbin/nologin caddy || true
mkdir -p /etc/caddy /opt/otr
chown -R ec2-user /opt/otr
