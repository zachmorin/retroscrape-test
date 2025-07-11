const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('=== Playwright Installation Script ===');
console.log('Current directory:', process.cwd());
console.log('Environment:', process.env.NODE_ENV);

// Set browser path
const browsersPath = '/opt/render/.cache/ms-playwright';
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

console.log('Browser installation path:', browsersPath);

// Clean existing installation
console.log('\nCleaning existing Playwright installation...');
try {
  execSync(`rm -rf ${browsersPath}`, { stdio: 'inherit' });
  console.log('Cleaned successfully');
} catch (err) {
  console.log('No existing installation to clean');
}

// Install browsers
console.log('\nInstalling Chromium...');
try {
  execSync('npx playwright install chromium', { 
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath }
  });
  console.log('Installation command completed');
} catch (err) {
  console.error('Installation failed:', err.message);
  process.exit(1);
}

// Verify installation
console.log('\nVerifying installation...');
if (fs.existsSync(browsersPath)) {
  console.log('Browsers directory exists');
  try {
    const contents = fs.readdirSync(browsersPath);
    console.log('Contents:', contents);
  } catch (err) {
    console.error('Cannot read directory:', err.message);
  }
} else {
  console.error('Browsers directory does not exist!');
  process.exit(1);
}

console.log('\nInstallation script completed'); 