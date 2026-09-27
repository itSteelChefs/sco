#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

template='infrastructure/nginx/staging-edge.conf.template'
for expected in 'server_name staging.sco.sa;' 'server_name operations.staging.sco.sa;' 'proxy_pass http://127.0.0.1:3101;' 'proxy_pass http://127.0.0.1:3102;' 'proxy_pass http://127.0.0.1:3103;' 'proxy_set_header X-Forwarded-For $remote_addr;' 'location ^~ /internal/ { return 404; }' 'location ^~ /health/ { return 404; }' 'include /etc/nginx/sco/operations-management-access.conf;'; do
  grep -Fq "$expected" "$template" || { echo "Missing staging edge contract: $expected" >&2; exit 1; }
done
! grep -Fq 'proxy_add_x_forwarded_for' "$template" || { echo 'Staging edge must replace, not append, X-Forwarded-For' >&2; exit 1; }
! grep -Fq 'deploy-production:' .github/workflows/release.yml || { echo 'Production deployment must remain disabled' >&2; exit 1; }
! grep -Fq 'DEPLOY_ENVIRONMENT: production' .github/workflows/release.yml || { echo 'Release workflow must not target Production' >&2; exit 1; }
grep -Fq 'Only staging deployment is authorized' scripts/deploy/deploy-over-ssh.sh || { echo 'SSH deployment must be staging-only' >&2; exit 1; }
grep -Fq 'Staging services must bind to loopback' scripts/deploy/docker-host-release.sh || { echo 'Host release must require loopback binding' >&2; exit 1; }
bash -n scripts/deploy/deploy-over-ssh.sh
bash -n scripts/deploy/docker-host-release.sh

if ! command -v nginx >/dev/null; then
  echo 'Staging edge static contract passed; nginx is unavailable for syntax validation.'
  exit 0
fi

work_directory="$(mktemp -d)"
cleanup() { rm -rf "$work_directory"; }
trap cleanup EXIT INT TERM
openssl req -x509 -nodes -newkey rsa:2048 -keyout "$work_directory/key.pem" -out "$work_directory/cert.pem" -subj '/CN=staging.sco.sa' -days 1 >/dev/null 2>&1
sed -e "s|__SCO_TLS_CERTIFICATE__|$work_directory/cert.pem|g" -e "s|__SCO_TLS_CERTIFICATE_KEY__|$work_directory/key.pem|g" "$template" > "$work_directory/edge.conf"
mkdir -p "$work_directory/includes"
printf '%s\n' 'allow 127.0.0.1;' 'deny all;' > "$work_directory/includes/operations-management-access.conf"
sed -i "s|/etc/nginx/sco/operations-management-access.conf|$work_directory/includes/operations-management-access.conf|" "$work_directory/edge.conf"
cat > "$work_directory/nginx.conf" <<EOF
events {}
http { include $work_directory/edge.conf; }
EOF
nginx -t -c "$work_directory/nginx.conf" -p "$work_directory" >/dev/null
echo 'Staging edge static and nginx syntax validation passed.'