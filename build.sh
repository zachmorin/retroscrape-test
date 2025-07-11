#!/bin/bash
echo "Starting build process..."

# Install npm dependencies
echo "Installing npm dependencies..."
npm install --production

# Install Playwright browsers using our custom script
echo "Installing Playwright browsers..."
node install-playwright.js

echo "Build complete!" 