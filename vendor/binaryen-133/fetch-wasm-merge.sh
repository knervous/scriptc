#!/bin/bash
# Fetch binaryen 133's native wasm-merge and wasm-opt (the release's node build
# ships only wasm-opt, and runs it in Node). Pinned by sha256; extracts just
# those two and the libbinaryen they link.
# Output: vendor/binaryen-133/<platform>/binaryen-version_133/bin/{wasm-merge,wasm-opt}
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset=arm64-macos;  sum=ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8; lib=lib/libbinaryen.dylib ;;
  *) echo "fetch-wasm-merge: no pinned asset for $(uname -s)-$(uname -m); add its sha256 from the version_133 release" >&2; exit 2 ;;
esac
tarball="$here/$asset.tar.gz"
[ -f "$tarball" ] || curl -sSLo "$tarball" "https://github.com/WebAssembly/binaryen/releases/download/version_133/binaryen-version_133-$asset.tar.gz"
echo "$sum  $tarball" | shasum -a 256 -c - >/dev/null || { echo "fetch-wasm-merge: sha256 mismatch for $tarball" >&2; exit 1; }
mkdir -p "$here/$asset"
tar xzf "$tarball" -C "$here/$asset" binaryen-version_133/bin/wasm-merge binaryen-version_133/bin/wasm-opt "binaryen-version_133/$lib"
xattr -dr com.apple.quarantine "$here/$asset" 2>/dev/null || true
"$here/$asset/binaryen-version_133/bin/wasm-merge" --version
"$here/$asset/binaryen-version_133/bin/wasm-opt" --version
