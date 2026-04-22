#!/bin/bash
set -e

echo "1. Cleaning up old zip..."
rm -f function.zip

echo "2. Installing production dependencies..."
npm install --omit=dev

echo "3. Creating zip file..."
# Zip the handler, index.mjs (symlink/copy), package.json, and node_modules
cp reflect-handler.mjs index.mjs
zip -r function.zip index.mjs reflect-handler.mjs pushCopy.mjs matchReason.mjs package.json node_modules/

echo "4. Done! You can now upload function.zip to AWS Lambda."
