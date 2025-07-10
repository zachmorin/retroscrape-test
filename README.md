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
- The scraper only fetches images referenced via `<img>` tags.
- Some images may fail to load metadata due to CORS or network restrictions; these are skipped.
- File size is reported in kilobytes (KB). 