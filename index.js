const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const probe = require('probe-image-size');
const cors = require('cors');
const { URL } = require('url');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ipaddr = require('ipaddr.js');
const dnsPromises = require('dns').promises;
const { chromium } = require('playwright');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Debug mode flag - disabled in production
const DEBUG = process.env.NODE_ENV !== 'production';

// Log initial startup information
logger.info('Server starting', {
  nodeVersion: process.version,
  platform: process.platform,
  environment: process.env.NODE_ENV || 'development'
});

app.use(cors());
// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["*", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(limiter);

app.use(express.json());

// Serve static frontend files
app.use(express.static('public'));

// Helper to validate external URL against private IP ranges
async function isSafePublicUrl(target) {
  try {
    const parsed = new URL(target);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // Resolve host to IP addresses
    const records = await dnsPromises.lookup(parsed.hostname, { all: true });
    for (const rec of records) {
      const addr = ipaddr.parse(rec.address);
      if (addr.range() !== 'unicast' || addr.range() === 'private' || addr.range() === 'loopback' || addr.range() === 'linkLocal' || addr.range() === 'uniqueLocal') {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Helper to resolve relative image URLs
function resolveUrl(base, src) {
  try {
    if (src.startsWith('//')) {
      const baseUrl = new URL(base);
      return `${baseUrl.protocol}${src}`;
    }
    return new URL(src, base).href;
  } catch (e) {
    return null;
  }
}

// Helper to extract a file name from URL
function getFileName(fileUrl) {
  try {
    return decodeURIComponent(fileUrl.split('/').pop().split(/[?#]/)[0]) || 'image';
  } catch {
    return 'image';
  }
}

// Dynamic scraping function using Playwright
async function scrapeWithPlaywright(url) {
  let browser;
  const consoleMessages = [];
  const failedRequests = [];
  
  try {
    // Log memory usage for Render.com debugging
    const memUsage = process.memoryUsage();
    logger.debug('Memory before browser launch', { 
      url,
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024)
    });
    
    // Launch browser with stealth settings optimized for Render.com
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--run-all-compositor-stages-before-draw',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-ipc-flooding-protection',
        '--single-process', // Critical for Render.com's memory limits
        '--memory-pressure-off',
        '--max_old_space_size=460' // Reserve some memory for Node.js
      ]
    });
    
    logger.info('Browser launched successfully', { url });

    const page = await browser.newPage();

    // Capture console messages
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()
      });
    });

    // Track failed network requests
    page.on('requestfailed', request => {
      failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()
      });
    });

    // Track responses with error status codes
    page.on('response', response => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });

    // Remove automation indicators
    await page.addInitScript(() => {
      delete navigator.webdriver;
    });

    // Block unnecessary resources to speed up scraping
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();
      // Only block fonts and stylesheets for now, keep media for image loading
      if (['font', 'stylesheet'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to the page
    const navigationStart = Date.now();
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    const navigationTime = Date.now() - navigationStart;
    
    logger.info('Page loaded', { 
      url, 
      navigationTime,
      consoleMessageCount: consoleMessages.length,
      failedRequestCount: failedRequests.length
    });

    // Log console messages if any
    if (consoleMessages.length > 0) {
      logger.logBrowserConsole(url, consoleMessages);
    }

    // Log failed requests if any
    if (failedRequests.length > 0) {
      logger.logNetworkFailure(url, failedRequests);
    }

    // Wait for potential WordPress blocks or dynamic content
    try {
      await page.waitForSelector('img, [style*="background-image"], .wp-block-image', { 
        timeout: 5000 
      });
    } catch (e) {
      // Continue if no images found immediately
    }

    // Scroll to trigger lazy loading
    await page.evaluate(async () => {
      let previousHeight = 0;
      let scrollAttempts = 0;
      const maxScrolls = 5;
      
      while (scrollAttempts < maxScrolls) {
        const currentHeight = document.body.scrollHeight;
        if (currentHeight === previousHeight) break;
        
        window.scrollTo(0, currentHeight);
        await new Promise(resolve => setTimeout(resolve, 1000));
        previousHeight = currentHeight;
        scrollAttempts++;
      }
      
      // Scroll back to top
      window.scrollTo(0, 0);
    });

    // Wait for lazy images to load
    await page.waitForTimeout(2000);

    // Extract head content
    const headContent = await page.$eval('head', head => head.innerHTML).catch(() => '');

    // Extract all images and background images
    const imageData = await page.evaluate(() => {
      const images = [];
      const processedUrls = new Set();

      // Extract regular img tags
      const imgElements = Array.from(document.querySelectorAll('img'));
      imgElements.forEach(img => {
        let src = img.src;
        
        // Handle lazy loading attributes
        if (!src || src.includes('data:') || src.includes('placeholder')) {
          const lazyAttrs = ['data-src', 'data-original', 'data-url', 'data-lazy', 'data-lazy-src'];
          for (const attr of lazyAttrs) {
            const lazySrc = img.getAttribute(attr);
            if (lazySrc && !lazySrc.includes('data:')) {
              src = lazySrc;
              break;
            }
          }
        }

        if (src && !src.startsWith('data:') && !src.startsWith('javascript:') && !processedUrls.has(src)) {
          processedUrls.add(src);
          images.push({
            url: src,
            alt: img.alt || '-',
            width: img.naturalWidth || '-',
            height: img.naturalHeight || '-',
            className: img.className || ''
          });
        }
      });

      // Extract background images from computed styles
      const elementsWithBg = Array.from(document.querySelectorAll('*'));
      elementsWithBg.forEach(el => {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;
        
        if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
          const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
          if (urlMatch && urlMatch[1]) {
            const bgUrl = urlMatch[1];
            if (!bgUrl.startsWith('data:') && !bgUrl.startsWith('javascript:') && !processedUrls.has(bgUrl)) {
              processedUrls.add(bgUrl);
              images.push({
                url: bgUrl,
                alt: 'Background Image',
                width: '-',
                height: '-',
                className: el.className || ''
              });
            }
          }
        }
      });

      // Extract inline SVGs
      const svgElements = Array.from(document.querySelectorAll('svg'));
      svgElements.forEach(svg => {
        const svgHtml = svg.outerHTML;
        images.push({
          url: null,
          inline: true,
          content: svgHtml,
          width: svg.getAttribute('width') || '-',
          height: svg.getAttribute('height') || '-',
          type: 'svg',
          size: new Blob([svgHtml]).size,
          filename: '-',
          alt: '-'
        });
      });

      // Extract object tags with image data
      const objectElements = Array.from(document.querySelectorAll('object[data]'));
      objectElements.forEach(obj => {
        const data = obj.getAttribute('data');
        const type = obj.getAttribute('type') || '';
        
        // Filter for image-related object types
        const isImageObject = type.startsWith('image/') || 
                             data.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|tiff?)(\?|#|$)/i);
        
        if (data && isImageObject && !data.startsWith('data:') && !data.startsWith('javascript:') && !processedUrls.has(data)) {
          processedUrls.add(data);
          images.push({
            url: data,
            alt: obj.getAttribute('alt') || obj.textContent?.trim() || 'Object Image',
            width: obj.getAttribute('width') || '-',
            height: obj.getAttribute('height') || '-',
            className: obj.className || '',
            source: 'object'
          });
        }
      });

      // Extract favicon and app icons from head
      const faviconSelectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]', 
        'link[rel="apple-touch-icon"]',
        'link[rel="apple-touch-icon-precomposed"]',
        'link[rel="mask-icon"]',
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[name="msapplication-TileImage"]'
      ];

      faviconSelectors.forEach(selector => {
        const elements = Array.from(document.querySelectorAll(selector));
        elements.forEach(elem => {
          let iconUrl = null;
          let altText = 'Favicon/App Icon';
          
          if (elem.tagName.toLowerCase() === 'link') {
            iconUrl = elem.getAttribute('href');
            const rel = elem.getAttribute('rel') || '';
            if (rel.includes('apple')) {
              altText = 'Apple Touch Icon';
            } else if (rel.includes('mask')) {
              altText = 'Safari Mask Icon';
            } else {
              altText = 'Favicon';
            }
          } else if (elem.tagName.toLowerCase() === 'meta') {
            iconUrl = elem.getAttribute('content');
            const name = elem.getAttribute('name') || elem.getAttribute('property') || '';
            if (name.includes('og:image')) {
              altText = 'Open Graph Image';
            } else if (name.includes('twitter')) {
              altText = 'Twitter Card Image';
            } else if (name.includes('msapplication')) {
              altText = 'Windows Tile Image';
            }
          }

          if (iconUrl && !iconUrl.startsWith('data:') && !iconUrl.startsWith('javascript:') && !processedUrls.has(iconUrl)) {
            processedUrls.add(iconUrl);
            images.push({
              url: iconUrl,
              alt: altText,
              width: elem.getAttribute('sizes') ? elem.getAttribute('sizes').split('x')[0] || '-' : '-',
              height: elem.getAttribute('sizes') ? elem.getAttribute('sizes').split('x')[1] || '-' : '-',
              className: '',
              source: 'favicon'
            });
          }
        });
      });

      return images;
    });

    await browser.close();
    
    // Log memory after browser close
    const memAfter = process.memoryUsage();
    logger.debug('Memory after browser close', { 
      url,
      heapUsed: Math.round(memAfter.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memAfter.heapTotal / 1024 / 1024),
      rss: Math.round(memAfter.rss / 1024 / 1024)
    });

    // Process the extracted image data
    const results = [];
    
    for (const img of imageData) {
      if (img.inline) {
        // Handle inline SVG
        results.push(img);
      } else {
        // Handle regular images
        const meta = {
          url: img.url,
          width: img.width !== '-' ? img.width : '-',
          height: img.height !== '-' ? img.height : '-',
          type: '-',
          size: '-',
          filename: getFileName(img.url),
          inline: false,
          alt: img.alt
        };

        // Try to get additional metadata using probe
        try {
          const info = await probe(img.url);
          meta.width = info.width;
          meta.height = info.height;
          meta.type = info.type;
          meta.size = info.length;
        } catch (e) {
          // If probe fails, try to extract type from URL
          const ext = img.url.split('.').pop().split(/#|\?/)[0];
          if (ext && ext.length <= 5) {
            meta.type = ext;
          }
        }

        results.push(meta);
      }
    }

    logger.info('Scraping completed successfully', {
      url,
      method: 'dynamic',
      imageCount: results.length,
      consoleMessages: consoleMessages.length,
      failedRequests: failedRequests.length
    });

    return { images: results, headContent };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    
    // Comprehensive error logging
    const context = {
      consoleMessages,
      failedRequests,
      userAgent: 'Chromium (Playwright)',
      memory: process.memoryUsage()
    };
    
    logger.logScrapingError(url, 'dynamic', error, context);
    
    // Provide more specific error messages
    if (error.message.includes('Protocol error') || error.message.includes('Target closed')) {
      throw new Error(`Browser crashed (likely memory limit exceeded). Consider using static scraping mode.`);
    } else if (error.message.includes('Navigation timeout')) {
      throw new Error(`Page load timeout. The website may be slow or blocking automated access.`);
    } else if (error.message.includes('Launch failed')) {
      throw new Error(`Browser launch failed. This may be due to missing system dependencies in the hosting environment.`);
    }
    
    throw error;
  }
}

// Static scraping function (extracted from original endpoint)
async function scrapeStatic(url, scrapeLazy = true) {
  try {
    logger.debug('Starting static scraping', { url, scrapeLazy });
    
    const response = await axios.get(url, { 
      timeout: 8000, 
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: (status) => status < 500 // Don't throw on 4xx errors
    });
    
    logger.debug('Static scraping response received', { 
      url,
      status: response.status,
      contentLength: response.headers['content-length'],
      contentType: response.headers['content-type']
    });
    
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const $ = cheerio.load(response.data);

    // Extract head content
    const headContent = $('head').html() || '';

    const imgSrcs = new Set();
    const imgData = new Map(); // Store additional data like alt text
    
    $('img').each((_, elem) => {
      let src = $(elem).attr('src');
      const altText = $(elem).attr('alt') || '-';

      if (!src && scrapeLazy) {
        const candidates = [
          'data-src',
          'data-original',
          'data-url',
          'data-lazy',
          'data-srcset',
          'data-lazy-src'
        ];
        for (const attr of candidates) {
          const val = $(elem).attr(attr);
          if (val) { src = val; break; }
        }
        // handle srcset like formats
        if (src && src.includes(',')) {
          src = src.split(',')[0].trim().split(' ')[0];
        }
      }

      if (src) {
        const full = resolveUrl(url, src);
        if (!full) return;
        if (full.startsWith('data:') || full.startsWith('javascript:')) return;
        imgSrcs.add(full);
        // Store alt text for this URL
        imgData.set(full, { alt: altText });
      }
    });

    const results = [];

    // Extract background images from inline style attributes
    $('[style*="url("]').each((_, elem) => {
      const style = $(elem).attr('style');
      if (!style) return;
      const urlRegex = /url\((['\"]?)(.*?)\1\)/gi;
      let match;
      while ((match = urlRegex.exec(style)) !== null) {
        const raw = match[2];
        if (!raw) continue;
        const full = resolveUrl(url, raw);
        if (!full) continue;
        if (full.startsWith('data:') || full.startsWith('javascript:')) continue;
        imgSrcs.add(full);
      }
    });

    // Extract inline SVG elements embedded directly in HTML
    $('svg').each((i, elem) => {
      const svgHtml = $.html(elem);
      results.push({
        url: null,
        inline: true,
        content: svgHtml,
        width: $(elem).attr('width') || '-',
        height: $(elem).attr('height') || '-',
        type: 'svg',
        size: Buffer.byteLength(svgHtml, 'utf8'),
        filename: '-',
        alt: '-' // SVGs don't have alt text
      });
    });

    // Extract object tags with image data
    $('object[data]').each((_, elem) => {
      const data = $(elem).attr('data');
      const type = $(elem).attr('type') || '';
      
      // Filter for image-related object types
      const isImageObject = type.startsWith('image/') || 
                           data?.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|tiff?)(\?|#|$)/i);
      
      if (data && isImageObject) {
        const full = resolveUrl(url, data);
        if (!full) return;
        if (full.startsWith('data:') || full.startsWith('javascript:')) return;
        imgSrcs.add(full);
        // Store alt text or fallback text for this URL
        const altText = $(elem).attr('alt') || $(elem).text()?.trim() || 'Object Image';
        imgData.set(full, { alt: altText, source: 'object' });
      }
    });

    // Extract favicon and app icons from head
    const faviconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]', 
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]',
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="msapplication-TileImage"]'
    ];

    faviconSelectors.forEach(selector => {
      $(selector).each((_, elem) => {
        let iconUrl = null;
        let altText = 'Favicon/App Icon';
        
        if (elem.tagName.toLowerCase() === 'link') {
          iconUrl = $(elem).attr('href');
          const rel = $(elem).attr('rel') || '';
          if (rel.includes('apple')) {
            altText = 'Apple Touch Icon';
          } else if (rel.includes('mask')) {
            altText = 'Safari Mask Icon';
          } else {
            altText = 'Favicon';
          }
        } else if (elem.tagName.toLowerCase() === 'meta') {
          iconUrl = $(elem).attr('content');
          const name = $(elem).attr('name') || $(elem).attr('property') || '';
          if (name.includes('og:image')) {
            altText = 'Open Graph Image';
          } else if (name.includes('twitter')) {
            altText = 'Twitter Card Image';
          } else if (name.includes('msapplication')) {
            altText = 'Windows Tile Image';
          }
        }

        if (iconUrl) {
          const full = resolveUrl(url, iconUrl);
          if (!full) return;
          if (full.startsWith('data:') || full.startsWith('javascript:')) return;
          imgSrcs.add(full);
          
          // Extract dimensions from sizes attribute if available
          const sizes = $(elem).attr('sizes') || '';
          const sizeParts = sizes.split('x');
          const width = sizeParts[0] || '-';
          const height = sizeParts[1] || '-';
          
          imgData.set(full, { 
            alt: altText, 
            source: 'favicon',
            width: width,
            height: height
          });
        }
      });
    });

    for (const imgUrl of imgSrcs) {
      const imgInfo = imgData.get(imgUrl) || {};
      const meta = {
        url: imgUrl,
        width: imgInfo.width || '-',
        height: imgInfo.height || '-',
        type: '-',
        size: '-',
        filename: getFileName(imgUrl),
        inline: false,
        alt: imgInfo.alt || '-', // Use stored alt text or default to '-'
        source: imgInfo.source || 'img' // Track source: 'img', 'object', etc.
      };
      try {
        // quick HEAD check for size
        try {
          const head = await axios.head(imgUrl, { timeout: 8000 });
          const len = parseInt(head.headers['content-length'] || '0', 10);
          if (len && len > 5 * 1024 * 1024) throw new Error('too big');
        } catch {}

        const info = await probe(imgUrl);
        meta.width = info.width;
        meta.height = info.height;
        meta.type = info.type;
        meta.size = info.length; // bytes
      } catch (_) {
        // If probe fails (e.g., SVG or remote restriction), still include the image
        const ext = imgUrl.split('.').pop().split(/#|\?/)[0];
        if (ext.length <= 5) meta.type = ext;
      }
      results.push(meta);
    }

    logger.info('Static scraping completed successfully', {
      url,
      method: 'static',
      imageCount: results.length
    });

    return { images: results, headContent };
    
  } catch (error) {
    logger.logScrapingError(url, 'static', error, {
      timeout: 8000,
      maxContentLength: 5 * 1024 * 1024
    });
    throw error;
  }
}

// Enhanced scrape endpoint with hybrid static/dynamic approach
app.post('/api/scrape', async (req, res) => {
  const { url, lazy: scrapeLazy = true, dynamic = 'auto' } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'No url provided' });
  }

  if (!(await isSafePublicUrl(url))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  let scrapingMethod = 'static';
  let fallbackUsed = false;

  try {
    let result = { images: [], headContent: '' };
    let staticAttempted = false;
    let dynamicAttempted = false;
    let staticSuccess = false;
    let dynamicSuccess = false;
    let staticError = null;
    let dynamicError = null;

    // If dynamic is forced, skip static scraping
    if (dynamic === 'dynamic') {
      logger.debug(`Dynamic scraping requested for: ${url}`);
      dynamicAttempted = true;
      try {
        result = await scrapeWithPlaywright(url);
        scrapingMethod = 'dynamic';
        dynamicSuccess = true;
        logger.debug(`Dynamic scraping successful for: ${url} (${result.images.length} images)`);
      } catch (dynamicErr) {
        dynamicError = dynamicErr.message;
        throw dynamicErr;
      }
    } else {
      // Try static scraping first for 'static' or 'auto' modes
      logger.debug(`Attempting static scraping for: ${url}`);
      staticAttempted = true;
      try {
        result = await scrapeStatic(url, scrapeLazy);
        scrapingMethod = 'static';
        staticSuccess = true;
        logger.debug(`Static scraping successful for: ${url} (${result.images.length} images)`);
      } catch (staticErr) {
        staticError = staticErr.message;
        logger.debug(`Static scraping failed for: ${url} - ${staticErr.message}`);
      }

              // Intelligent fallback logic for auto mode - always try dynamic to compare results
        if (dynamic === 'auto') {
          logger.debug(`Auto mode: trying dynamic scraping to compare with static results for: ${url}`);
          fallbackUsed = true;
          dynamicAttempted = true;
          try {
            const dynamicResult = await scrapeWithPlaywright(url);
            // Use dynamic result if it found significantly more images or if static failed
            if (dynamicResult.images.length > result.images.length || !staticSuccess) {
              result = dynamicResult;
              scrapingMethod = 'dynamic';
              dynamicSuccess = true;
              logger.debug(`Dynamic scraping successful for: ${url} (${result.images.length} images, using dynamic result)`);
            } else {
              logger.debug(`Dynamic scraping found ${dynamicResult.images.length} images, keeping static result (${result.images.length} images)`);
              dynamicSuccess = true; // Still mark as successful
            }
          } catch (dynamicErr) {
            dynamicError = dynamicErr.message;
            logger.debug(`Dynamic scraping failed, keeping static result: ${dynamicErr.message}`);
            // Don't throw - keep the static result
          }
        }
    }

    // Return enhanced response with scraping metadata
    const response = {
      images: result.images,
      headContent: result.headContent,
      scrapingMethod: scrapingMethod,
      fallbackUsed: fallbackUsed,
      totalImages: result.images.length
    };

    // Only include debug info when DEBUG mode is enabled
    if (DEBUG) {
      response.debug = {
        staticAttempted,
        dynamicAttempted,
        staticSuccess,
        dynamicSuccess,
        staticError,
        dynamicError
      };
    }

    return res.json(response);

  } catch (err) {
    logger.error(`Error scraping ${url}:`, err.message);
    logger.debug(`Full error:`, err);
    
    // If dynamic scraping failed and we haven't tried static yet, try static as fallback
    if (scrapingMethod === 'dynamic' && !fallbackUsed) {
      try {
        logger.debug(`Dynamic scraping failed, trying static fallback for: ${url}`);
        const result = await scrapeStatic(url, scrapeLazy);
        const fallbackResponse = {
          images: result.images,
          headContent: result.headContent,
          scrapingMethod: 'static',
          fallbackUsed: true,
          totalImages: result.images.length
        };

        // Only include warning when DEBUG mode is enabled
        if (DEBUG) {
          fallbackResponse.warning = 'Dynamic scraping failed, used static fallback';
        }

        return res.json(fallbackResponse);
      } catch (staticErr) {
        logger.debug(`Static fallback also failed:`, staticErr.message);
      }
    }

    const errorResponse = { 
      error: 'Failed to scrape the provided URL.'
    };

    // Only include debug info when DEBUG mode is enabled
    if (DEBUG) {
      errorResponse.scrapingMethod = scrapingMethod;
      errorResponse.fallbackUsed = fallbackUsed;
      errorResponse.errorMessage = err.message;
    }

    return res.status(500).json(errorResponse);
  }
});

// Stream image for download
app.get('/api/download', async (req, res) => {
  const { imgUrl } = req.query;
  if (!imgUrl) return res.status(400).send('Missing imgUrl parameter');

  if (!(await isSafePublicUrl(imgUrl))) {
    return res.status(400).send('URL not allowed');
  }

  try {
    const response = await axios.get(imgUrl, { responseType: 'stream', timeout: 8000, maxContentLength: 5 * 1024 * 1024 });
    const filename = decodeURIComponent(imgUrl.split('/').pop() || 'image');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    response.data.pipe(res);
  } catch (err) {
    logger.error('Failed to download image', { imgUrl, error: err.message });
    res.status(500).send('Failed to download image');
  }
});

// Health check endpoint for monitoring and load balancers
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Protected logs endpoint for production debugging
app.get('/api/logs', (req, res) => {
  // Simple authentication with query parameter
  const key = req.query.key;
  const expectedKey = process.env.LOGS_ACCESS_KEY || 'debug123';
  
  if (key !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Get query parameters
  const limit = parseInt(req.query.limit) || 50;
  const level = req.query.level || null; // ERROR, WARN, INFO, DEBUG
  
  try {
    const logs = logger.getRecentLogs(limit, level);
    
    // Calculate summary statistics
    const errorCount = logs.filter(log => log.level === 'ERROR').length;
    const warnCount = logs.filter(log => log.level === 'WARN').length;
    
    // Group errors by URL for pattern detection
    const errorsByUrl = {};
    logs.filter(log => log.level === 'ERROR' && log.url).forEach(log => {
      const url = log.url;
      if (!errorsByUrl[url]) {
        errorsByUrl[url] = {
          count: 0,
          lastError: log.timestamp,
          errors: []
        };
      }
      errorsByUrl[url].count++;
      errorsByUrl[url].errors.push({
        timestamp: log.timestamp,
        message: log.errorMessage || log.message
      });
    });
    
    res.json({
      summary: {
        totalLogs: logs.length,
        errors: errorCount,
        warnings: warnCount,
        timeRange: {
          from: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
          to: logs.length > 0 ? logs[0].timestamp : null
        }
      },
      errorPatterns: errorsByUrl,
      logs: logs
    });
  } catch (err) {
    logger.error('Failed to retrieve logs', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Debug mode: ${DEBUG ? 'enabled' : 'disabled'}`);
  
  // Log deployment diagnostics for Render.com
  if (process.env.NODE_ENV === 'production') {
    const memUsage = process.memoryUsage();
    logger.info('Production startup diagnostics', { 
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      },
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime()
    });
    
    // Test if Playwright is properly installed
    (async () => {
      try {
        const { chromium } = require('playwright');
        logger.info('Playwright chromium module loaded successfully');
        
        // Test browser launch
        logger.info('Testing browser launch capability...');
        const testBrowser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process']
        });
        await testBrowser.close();
        logger.info('Browser launch test successful');
      } catch (err) {
        logger.error('Browser launch test failed', { 
          error: err.message,
          stack: err.stack
        });
      }
    })();
  }
}); 