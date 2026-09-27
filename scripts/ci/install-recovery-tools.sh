#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 022

if ((EUID == 0)); then
  privilege=()
elif command -v sudo >/dev/null 2>&1; then
  privilege=(sudo -n)
else
  echo 'Root or non-interactive sudo is required to install recovery tools.' >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
[[ -n "${VERSION_CODENAME:-}" ]] || { echo 'VERSION_CODENAME is unavailable.' >&2; exit 1; }

"${privilege[@]}" apt-get update
DEBIAN_FRONTEND=noninteractive "${privilege[@]}" apt-get install -y age ca-certificates curl shellcheck
"${privilege[@]}" install -d -m 0755 /usr/share/postgresql-common/pgdg
temporary_key="$(mktemp)"
trap 'rm -f "$temporary_key"' EXIT
curl --fail --silent --show-error --location https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$temporary_key"
"${privilege[@]}" install -m 0644 "$temporary_key" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$VERSION_CODENAME" | "${privilege[@]}" tee /etc/apt/sources.list.d/pgdg.list >/dev/null
"${privilege[@]}" apt-get update
DEBIAN_FRONTEND=noninteractive "${privilege[@]}" apt-get install -y postgresql-client-17

age --version
shellcheck --version
/usr/lib/postgresql/17/bin/pg_dump --version