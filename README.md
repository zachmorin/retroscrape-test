# Image Scraper Web App

This application lets you input a website URL, scrapes all images on that page, and displays them with metadata such as dimensions, file size, and format. You can copy image URLs or download the images directly. Columns (width, height, size, format) are sortable.

## Prerequisites
- Node.js 16+

## Setup
```bash
npm install
npm start
```
The app will be available at `http://localhost:3000`.

## Usage
1. Enter a full website URL (including `http://` or `https://`).
2. Click **Scrape**.
3. Wait a few seconds for the results to load.
4. Click column headers to sort.
5. Use **Copy URL** or **Download** for any image.

---

### Notes
- The scraper fetches standard images (`<img>` tags), lazy-loaded images, background images, and embedded SVG images.
- Does not scrape images from CSS files or dynamically JavaScript-loaded content.
- Some images may fail to load metadata due to CORS or network restrictions; these are skipped.
- File size is reported in kilobytes (KB). 

## Production Debugging

### Error Logging

The application now includes comprehensive error logging to help diagnose production issues:

- **Log Files**: Logs are written to the `logs/` directory with daily rotation
- **Log Format**: JSON format for easy parsing and analysis
- **Memory Tracking**: Each log entry includes memory usage statistics
- **Browser Console**: Captures browser console messages during dynamic scraping
- **Network Failures**: Tracks failed network requests and HTTP errors

### Viewing Logs

Access logs via the protected endpoint:

```
GET /api/logs?key=YOUR_KEY&limit=50&level=ERROR
```

Parameters:
- `key`: Authentication key (set via `LOGS_ACCESS_KEY` env var, defaults to `debug123`)
- `limit`: Number of logs to return (default: 50)
- `level`: Filter by log level (ERROR, WARN, INFO, DEBUG)

Example:
```bash
curl "https://your-app.onrender.com/api/logs?key=debug123&limit=100&level=ERROR"
```

### Environment Variables

- `NODE_ENV`: Set to `production` for production logging behavior
- `LOGS_ACCESS_KEY`: Secret key for accessing the logs endpoint

### Troubleshooting Common Issues

1. **Memory Errors**: Check logs for high memory usage before crashes
2. **Bot Detection**: Look for console errors and blocked requests
3. **Timeouts**: Check navigation times and failed network requests
4. **Browser Launch Failures**: Review startup diagnostics in logs 