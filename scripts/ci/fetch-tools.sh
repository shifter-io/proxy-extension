#!/bin/bash
# Puts a pinned CI tool into $CI_CACHE_DIR/proxy-extension/tools and prints its
# folder. ci.yml's gate job and the nightly image hook (.github/ciod/prefetch.sh)
# both call it, with the pins from ci.yml's env: block (README.md, "Continuous
# integration").
#
# usage: bash scripts/ci/fetch-tools.sh actionlint|firefox
#
# A tool already in the cache is never downloaded. Otherwise the download is
# retried for about a minute, checked against its SHA-256, unpacked into a
# hidden folder and renamed into place complete, so a half-written tool is never
# used. Other versions of the tool are removed.
set -euo pipefail
tools="${CI_CACHE_DIR:?is not set}/proxy-extension/tools"

case "${1:-}" in
  actionlint)
    version="${ACTIONLINT_VERSION:?is not set}" sha="${ACTIONLINT_SHA256:?is not set}"
    bin=actionlint members=(actionlint)
    url="https://github.com/rhysd/actionlint/releases/download/v$version/actionlint_${version}_linux_amd64.tar.gz"
    ;;
  firefox)
    version="${FIREFOX_VERSION:?is not set}" sha="${FIREFOX_SHA256:?is not set}"
    bin=firefox/firefox members=()
    url="https://archive.mozilla.org/pub/firefox/releases/$version/linux-x86_64/en-US/firefox-$version.tar.xz"
    ;;
  *) echo "usage: $0 actionlint|firefox" >&2; exit 2 ;;
esac
name="$1"
dir="$tools/$name-$version"
mkdir -p "$tools"
if [ -x "$dir/$bin" ]; then
  echo "$name $version: from the cache, $dir" >&2
else
  echo "$name $version: not in the cache, downloading $url" >&2
  tmp=$(mktemp -d "$tools/.$name-XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  archive="$tmp/${url##*/}"
  curl -fsSL --retry 6 --retry-delay 10 --retry-all-errors -o "$archive" "$url"
  echo "$sha  $archive" | sha256sum -c --quiet -
  tar -C "$tmp" -xf "$archive" "${members[@]}"
  rm -f "$archive"
  rm -rf "$dir" && mv -T "$tmp" "$dir"
  echo "$name $version: checksum verified, saved to $dir" >&2
fi
find "$tools" -mindepth 1 -maxdepth 1 -name "$name-*" ! -name "$name-$version" -exec rm -rf {} +
echo "$dir"
