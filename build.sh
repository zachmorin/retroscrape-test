#!/bin/bash
echo "Starting build process..."

# Install npm dependencies
echo "Installing npm dependencies..."
npm install

# Install Playwright browsers
echo "Installing Playwright browsers..."
npx playwright install chromium --with-deps

echo "Build complete!" 