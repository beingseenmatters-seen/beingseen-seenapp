#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Seen backend — Lambda deployment packaging
#
# Canonical entrypoint: index.mjs  ->  AWS Lambda handler must be "index.handler"
#
# index.mjs contains the T-301 routing + Resonance Engine V2 (./resonance.mjs),
# the /match/candidate route, and imports ./pushCopy.mjs and ./matchReason.mjs.
#
# reflect-handler.mjs is the LEGACY standalone handler. It is packaged for
# reference/parity only and MUST NEVER overwrite index.mjs. The previous version
# of this script ran `cp reflect-handler.mjs index.mjs`, which silently shipped a
# build with none of the T-301 backend. That overwrite has been removed.
# ---------------------------------------------------------------------------

echo "1. Cleaning up old zip..."
rm -f function.zip

echo "2. Installing production dependencies..."
npm install --omit=dev

echo "3. Verifying canonical entrypoint (index.mjs)..."
if ! grep -q "export const handler" index.mjs; then
  echo "ERROR: index.mjs does not export a handler — refusing to package." >&2
  exit 1
fi
if ! grep -q "resonance.mjs" index.mjs; then
  echo "ERROR: index.mjs is missing the ./resonance.mjs import (T-301) — likely overwritten. Refusing to package." >&2
  exit 1
fi
if ! grep -q "/match/candidate" index.mjs; then
  echo "ERROR: index.mjs is missing the /match/candidate route — refusing to package." >&2
  exit 1
fi

echo "4. Creating zip file (index.mjs stays canonical; no overwrite)..."
zip -r function.zip \
  index.mjs \
  reflect-handler.mjs \
  resonance.mjs \
  matchReason.mjs \
  pushCopy.mjs \
  package.json \
  node_modules/ \
  > /dev/null

echo "5. Packaged runtime modules:"
unzip -l function.zip | grep -E "\.mjs$|/package.json$" | grep -v "node_modules/" || true

echo
echo "6. Done. Upload function.zip to AWS Lambda and ensure the handler is 'index.handler'."
