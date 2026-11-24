#!/bin/zsh
# Builds a copy of the extension that talks to the website running on
# http://localhost:3000 instead of production, for testing cloud features
# (Google sign-in, team templates) before deploying. Load `local-test/` as an
# unpacked extension in chrome://extensions. Repo files are not changed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$ROOT_DIR/local-test"
LOCAL_URL="${1:-http://localhost:3000}"

"$ROOT_DIR/build-shareable.sh" >/dev/null
rm -rf "$OUTPUT_DIR"
cp -R "$ROOT_DIR/shareable" "$OUTPUT_DIR"

sed -i '' "s#shared.CLOUD_API_BASE_URL = \"https://contactpoint.vercel.app\";#shared.CLOUD_API_BASE_URL = \"$LOCAL_URL\";#" \
  "$OUTPUT_DIR/shared/config.js"
grep -q "CLOUD_API_BASE_URL = \"$LOCAL_URL\"" "$OUTPUT_DIR/shared/config.js" || {
  echo "Could not point shared/config.js at $LOCAL_URL" >&2
  exit 1
}

python3 - "$OUTPUT_DIR/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest["name"] = manifest["name"] + " (local test)"
manifest["externally_connectable"] = {"matches": ["http://localhost/*", "http://127.0.0.1/*"]}
json.dump(manifest, open(path, "w"), indent=2, ensure_ascii=False)
PY

echo "Local test extension written to: $OUTPUT_DIR (cloud: $LOCAL_URL)"
