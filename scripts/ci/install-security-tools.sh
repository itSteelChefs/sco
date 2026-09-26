#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo 'Usage: install-security-tools.sh INSTALL_DIRECTORY [actionlint|gitleaks|trivy ...]' >&2
  exit 64
fi

install_directory=$1
shift
requested=("$@")
if [[ ${#requested[@]} -eq 0 ]]; then requested=(actionlint gitleaks trivy); fi
mkdir -p "$install_directory"
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT
cd "$temporary_directory"

install_release() {
  local tool=$1
  local version=$2
  local archive=$3
  local checksums=$4
  local release_url=$5
  local binary_path=$6
  curl --fail --silent --show-error --location --retry 3 --output "$archive" "$release_url/$archive"
  curl --fail --silent --show-error --location --retry 3 --output "$checksums" "$release_url/$checksums"
  local checksum_line
  checksum_line=$(grep -F "  $archive" "$checksums")
  [[ -n $checksum_line ]] || { echo "Checksum entry missing for $archive" >&2; exit 1; }
  printf '%s\n' "$checksum_line" | sha256sum --check --strict -
  mkdir "$tool"
  tar -xzf "$archive" -C "$tool"
  install -m 0755 "$tool/$binary_path" "$install_directory/$tool"
}

for tool in "${requested[@]}"; do
  case "$tool" in
    actionlint)
      install_release actionlint 1.7.12 actionlint_1.7.12_linux_amd64.tar.gz actionlint_1.7.12_checksums.txt https://github.com/rhysd/actionlint/releases/download/v1.7.12 actionlint
      ;;
    gitleaks)
      install_release gitleaks 8.30.1 gitleaks_8.30.1_linux_x64.tar.gz gitleaks_8.30.1_checksums.txt https://github.com/gitleaks/gitleaks/releases/download/v8.30.1 gitleaks
      ;;
    trivy)
      install_release trivy 0.74.0 trivy_0.74.0_Linux-64bit.tar.gz trivy_0.74.0_checksums.txt https://github.com/aquasecurity/trivy/releases/download/v0.74.0 trivy
      ;;
    *)
      echo "Unsupported security tool: $tool" >&2
      exit 64
      ;;
  esac
done
