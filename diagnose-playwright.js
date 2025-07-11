const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

console.log('=== Playwright Diagnostic Tool ===\n');

// Check environment
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Platform:', process.platform);
console.log('Node version:', process.version);
console.log('Current directory:', process.cwd());

// Check Playwright browsers path
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || 
  path.join(require('os').homedir(), '.cache', 'ms-playwright');
console.log('\nPlaywright browsers path:', browsersPath);
console.log('Path exists:', fs.existsSync(browsersPath));

// List browser directories if path exists
if (fs.existsSync(browsersPath)) {
  try {
    const contents = fs.readdirSync(browsersPath);
    console.log('Browser directories:', contents);
    
    // Check for chromium specifically
    const chromiumDirs = contents.filter(dir => dir.includes('chromium'));
    if (chromiumDirs.length > 0) {
      console.log('\nChromium installations found:', chromiumDirs);
      chromiumDirs.forEach(dir => {
        const fullPath = path.join(browsersPath, dir);
        const execPath = path.join(fullPath, 'chrome-linux', 'headless_shell');
        console.log(`  ${dir}: executable exists =`, fs.existsSync(execPath));
      });
    } else {
      console.log('\n⚠️  No Chromium installations found!');
    }
  } catch (err) {
    console.error('Error reading browsers path:', err.message);
  }
} else {
  console.log('\n⚠️  Browsers path does not exist!');
}

// Try to launch browser
console.log('\n\nAttempting to launch browser...');
(async () => {
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('✅ Browser launched successfully!');
    await browser.close();
    console.log('✅ Browser closed successfully!');
  } catch (err) {
    console.error('❌ Failed to launch browser:', err.message);
    
    // Provide solution
    console.log('\n\n=== SOLUTION ===');
    console.log('Run the following command to install Playwright browsers:');
    console.log('  npx playwright install chromium --with-deps');
    console.log('\nOr if you need all browsers:');
    console.log('  npx playwright install --with-deps');
  }
})(); 