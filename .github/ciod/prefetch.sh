#!/bin/bash
# The nightly ciod image build runs this hook from a read-only checkout of
# main, as a user that may write only $CI_CACHE_DIR/proxy-extension/ (README.md,
# "Continuous integration"). It fills what ci.yml's gate job would otherwise
# download: the pinned actionlint and Firefox, and the npm cache of both
# lockfiles. If it fails, the cache stays cold and gate downloads at run time.
set -euo pipefail
cache="${CI_CACHE_DIR:?is not set}/proxy-extension"

# The pins come from ci.yml's top-level env: block, their one copy.
pin() {
  awk -v key="$1:" '/^env:/ { e = 1; next } e && /^[^ #]/ { exit } e && $1 == key { print $2; exit }' \
    .github/workflows/ci.yml
}
for key in ACTIONLINT_VERSION ACTIONLINT_SHA256 FIREFOX_VERSION FIREFOX_SHA256; do
  value=$(pin "$key")
  [ -n "$value" ] || { echo "prefetch: $key is not in ci.yml's env: block" >&2; exit 1; }
  export "$key=$value"
done
bash scripts/ci/fetch-tools.sh actionlint >/dev/null
bash scripts/ci/fetch-tools.sh firefox >/dev/null

# npm ci in a scratch copy of each package.json and lockfile, then the copy goes.
export npm_config_cache="$cache/npm" npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
mkdir -p "$cache/npm"
scratch=$(mktemp -d "$cache/.npm-XXXXXX")
trap 'rm -rf "$scratch"' EXIT
for dir in . e2e; do
  mkdir -p "$scratch/$dir"
  cp "$dir/package.json" "$dir/package-lock.json" "$scratch/$dir/"
  (cd "$scratch/$dir" && npm ci --ignore-scripts)
  echo "npm cache: filled from $dir/package-lock.json" >&2
done
