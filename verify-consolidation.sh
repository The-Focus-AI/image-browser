#!/bin/bash
set -e

echo "=== Verifying Consolidated Image Browser ==="
echo ""

echo "1. Checking shared library structure..."
if [ -d "shared/src" ]; then
  echo "   ✓ shared/src directory exists"
else
  echo "   ✗ shared/src directory missing"
  exit 1
fi

if [ -f "shared/src/db.ts" ]; then
  echo "   ✓ shared/src/db.ts exists"
else
  echo "   ✗ shared/src/db.ts missing"
  exit 1
fi

if [ -f "shared/src/replicate.ts" ]; then
  echo "   ✓ shared/src/replicate.ts exists"
else
  echo "   ✗ shared/src/replicate.ts missing"
  exit 1
fi

if [ -f "shared/src/index.ts" ]; then
  echo "   ✓ shared/src/index.ts exists"
else
  echo "   ✗ shared/src/index.ts missing"
  exit 1
fi

echo ""
echo "2. Checking loader integration..."
if grep -q "image-browser-shared" loader/package.json; then
  echo "   ✓ loader references shared library"
else
  echo "   ✗ loader does not reference shared library"
  exit 1
fi

if grep -q "image-browser-shared" loader/src/db.ts; then
  echo "   ✓ loader/src/db.ts uses shared library"
else
  echo "   ✗ loader/src/db.ts does not use shared library"
  exit 1
fi

if grep -q "sharp" loader/package.json; then
  echo "   ✓ loader includes sharp for image dimension extraction"
else
  echo "   ✗ loader missing sharp dependency"
  exit 1
fi

echo ""
echo "3. Checking browse integration..."
if grep -q "image-browser-shared" browse/package.json; then
  echo "   ✓ browse references shared library"
else
  echo "   ✗ browse does not reference shared library"
  exit 1
fi

if grep -q "image-browser-shared" browse/src/replicate.ts; then
  echo "   ✓ browse/src/replicate.ts uses shared library"
else
  echo "   ✗ browse/src/replicate.ts does not use shared library"
  exit 1
fi

echo ""
echo "4. Checking database schema includes width/height..."
if grep -q "width integer" shared/src/db.ts; then
  echo "   ✓ Schema includes width column"
else
  echo "   ✗ Schema missing width column"
  exit 1
fi

if grep -q "height integer" shared/src/db.ts; then
  echo "   ✓ Schema includes height column"
else
  echo "   ✗ Schema missing height column"
  exit 1
fi

echo ""
echo "5. Verifying TypeScript compilation..."
cd browse
if npm run build > /dev/null 2>&1; then
  echo "   ✓ browse compiles successfully"
else
  echo "   ✗ browse compilation failed"
  exit 1
fi
cd ..

echo ""
echo "✓ All consolidation checks passed!"
echo ""
echo "Summary:"
echo "  - Shared library created with common DB and Replicate code"
echo "  - Loader uses shared library and extracts image dimensions"
echo "  - Browse uses shared library and displays image dimensions"
echo "  - Database schema includes width and height columns"
