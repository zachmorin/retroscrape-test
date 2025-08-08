// Simple identity pool with realistic tuples

const identities = [
  {
    id: 'id1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    isMobile: false,
    deviceScaleFactor: 1,
    hasTouch: false
  },
  {
    id: 'id2',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'light',
    isMobile: false,
    deviceScaleFactor: 2,
    hasTouch: false
  },
  {
    id: 'id3',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    isMobile: false,
    deviceScaleFactor: 1,
    hasTouch: false
  }
];

let rr = 0;

function getNextIdentity() {
  const identity = identities[rr % identities.length];
  rr += 1;
  return identity;
}

module.exports = { getNextIdentity };


