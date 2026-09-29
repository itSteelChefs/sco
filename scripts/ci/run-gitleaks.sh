#!/usr/bin/env bash
set -Eeuo pipefail

gitleaks git --redact --no-banner --verbose .

temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT
while IFS= read -r -d '' file; do
  [[ -f $file ]] || continue
  mkdir -p "$temporary_directory/$(dirname "$file")"
  cp -- "$file" "$temporary_directory/$file"
done < <(git ls-files --cached --others --exclude-standard -z)

gitleaks dir --redact --no-banner --verbose "$temporary_directory"
