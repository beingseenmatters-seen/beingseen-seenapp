#!/bin/bash
set -e

echo "1. Cleaning up old zip..."
rm -f function.zip

echo "2. Installing production dependencies..."
npm install --omit=dev

echo "3. Creating zip file..."
# Zip the handler and the node_modules folder
zip -r function.zip reflect-handler.mjs package.json node_modules/

echo "4. Done! You can now upload function.zip to AWS Lambda."
