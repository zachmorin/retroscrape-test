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

const app = express();
const PORT = process.env.PORT || 3000;

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
// Scrape endpoint
app.post('/api/scrape', async (req, res) => {
  const { url, lazy: scrapeLazy = true } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'No url provided' });
  }

  if (!(await isSafePublicUrl(url))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    const response = await axios.get(url, { timeout: 8000, maxContentLength: 5 * 1024 * 1024 });
    const $ = cheerio.load(response.data);

    const imgSrcs = new Set();
    $('img').each((_, elem) => {
      let src = $(elem).attr('src');

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
        filename: '-'
      });
    });

    for (const imgUrl of imgSrcs) {
      const meta = {
        url: imgUrl,
        width: '-',
        height: '-',
        type: '-',
        size: '-',
        filename: getFileName(imgUrl),
        inline: false
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

    return res.json(results);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to scrape the provided URL.' });
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
    console.error(err);
    res.status(500).send('Failed to download image');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
}); 