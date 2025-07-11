const form = document.getElementById('scrape-form');
const loading = document.getElementById('loading');
const table = document.getElementById('results-table');
const tbody = table.querySelector('tbody');
const historyList = document.getElementById('history');
const messageBox = document.getElementById('message');
const summaryBar = document.getElementById('summary-bar');
const summaryText = document.getElementById('summary');
const inlineToggle = document.getElementById('toggle-inline');
const inlineLabel = document.getElementById('inline-toggle-label');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const clearHistoryBtn = document.getElementById('clear-history');
const seoDrawer = document.getElementById('seo-drawer');
const drawerToggle = document.getElementById('drawer-toggle');
const drawerContent = document.getElementById('drawer-content');
const headContentPre = document.getElementById('head-content');
const copyDrawerBtn = document.getElementById('copy-drawer');
let loadingInterval;

// Feature toggle - set to false to disable SEO metadata feature
const SEO_FEATURE_ENABLED = seoDrawer ? seoDrawer.dataset.featureEnabled === 'true' : false;

function updateDisplayedCount(){
  let visible=0;
  tbody.querySelectorAll('tr').forEach(tr=>{ if(tr.style.display!== 'none') visible++; });
  if(summaryText) summaryText.textContent = `Total Images: ${visible}`;
}

function updateClearBtn(){
  if(!clearSearchBtn) return;
  const hasTerm = searchInput && searchInput.value.trim().length>0;
  clearSearchBtn.disabled = !hasTerm;
}

function updateRowVisibility(){
  const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const showInline = inlineToggle ? inlineToggle.checked : true;
  tbody.querySelectorAll('tr').forEach(tr=>{
      const inline = tr.dataset.inline==='true';
      const matchSearch = !term || tr.textContent.toLowerCase().includes(term);
      const visible = matchSearch && (showInline || !inline);
      tr.style.display = visible ? '' : 'none';
  });
  updateDisplayedCount();
  updateClearBtn();
}

if(searchInput){
  searchInput.addEventListener('input', ()=>{ updateRowVisibility(); });
}

if (inlineToggle) {
  inlineToggle.addEventListener('change', updateRowVisibility);
}

if(clearSearchBtn){
  clearSearchBtn.addEventListener('click', ()=>{
    if(searchInput){searchInput.value='';}
    updateRowVisibility();
  });
  clearSearchBtn.disabled = true;
}

function showMessage(text, isError = true) {
  messageBox.textContent = text;
  messageBox.style.display = 'block';
  const isDark = document.body.classList.contains('dark');
  if (isError) {
    messageBox.classList.add('error');
    messageBox.style.color = isDark ? '#f55' : 'red';
  } else {
    messageBox.classList.remove('error');
    messageBox.style.color = isDark ? '#e6e6e6' : 'black';
  }
}

function clearMessage() {
  messageBox.style.display = 'none';
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function updateClearHistoryBtn() {
  if (!clearHistoryBtn) return;
  const hasHistory = historyList && historyList.children.length > 0;
  clearHistoryBtn.disabled = !hasHistory;
}

function renderHistory(arr) {
  if (!historyList) return;
  historyList.innerHTML = '';
  arr.forEach(item => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    const link = typeof item === 'string' ? item : item.url;
    const count = typeof item === 'string' ? null : item.count;
    const isErr = typeof item === 'string' ? false : item.error;
    const displayText = link.length > 25 ? link.slice(0, 22) + '...' : link;
    a.textContent = `${count != null ? '[' + count + '] ' : ''}${displayText}`;
    a.title = link;
    if (isErr) a.classList.add('error-link');
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById('website-url').value = link;
      form.requestSubmit();
    });

    // remove X span
    const x = document.createElement('span');
    x.textContent = '×';
    x.className = 'remove-link';
    x.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      ev.preventDefault();
      removeHistory(link);
    });

    a.appendChild(x);
    li.appendChild(a);
    historyList.appendChild(li);
  });
  updateClearHistoryBtn();
}

function loadHistory() {
  const local = localStorage.getItem('scraperHistory');
  let arr = [];
  if (local) {
    try { arr = JSON.parse(local); } catch {}
  } else {
    const cookieStr = getCookie('scraperHistory');
    if (cookieStr) {
      try { arr = JSON.parse(cookieStr); } catch {}
    }
  }
  renderHistory(arr);
}

function saveHistory(url, count = null, error = false) {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem('scraperHistory') || '[]'); } catch {}

  // normalize old string entries
  arr = arr.map(it => (typeof it === 'string' ? { url: it } : it));

  const existing = arr.find(it => it.url === url);
  if (existing) {
    existing.count = count;
    existing.error = error;
  } else {
    arr.unshift({ url, count, error });
  }

  if (arr.length > 10) arr = arr.slice(0, 10);

  const str = JSON.stringify(arr);
  localStorage.setItem('scraperHistory', str);
  document.cookie = `scraperHistory=${encodeURIComponent(str)};path=/;max-age=31536000`;
  renderHistory(arr);
}

function removeHistory(targetUrl){
  let arr=[];
  try{arr=JSON.parse(localStorage.getItem('scraperHistory')||'[]');}catch{}
  arr=arr.filter(it=> (typeof it==='string'? it: it.url)!==targetUrl);
  const str=JSON.stringify(arr);
  localStorage.setItem('scraperHistory',str);
  document.cookie=`scraperHistory=${encodeURIComponent(str)};path=/;max-age=31536000`;
  renderHistory(arr);
}

if(clearHistoryBtn){
  clearHistoryBtn.addEventListener('click', ()=>{
  localStorage.removeItem('scraperHistory');
  document.cookie='scraperHistory=;path=/;max-age=0';
  historyList.innerHTML='';
    updateClearHistoryBtn();
});
}

// helper to handle response
async function handleScrape(url, includeLazy = true) {
  tbody.innerHTML = '';
  table.style.display = 'none';
  if (summaryBar) summaryBar.style.display = 'none';
  if (inlineLabel) inlineLabel.style.display = 'none';
  if (seoDrawer && SEO_FEATURE_ENABLED) seoDrawer.style.display = 'none';
  clearMessage();
  loading.textContent = 'Loading';
  loading.style.display = 'block';
  let dots = 0;
  clearInterval(loadingInterval);
  loadingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    loading.textContent = 'Loading' + '.'.repeat(dots);
  }, 500);

  showMessage('Large pages with many images may take longer to load.', false);

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, lazy: includeLazy })
    });
    const data = await res.json();
    loading.style.display = 'none';
    clearInterval(loadingInterval);
    clearMessage();

    if (!res.ok) {
      showMessage(data.error || 'Failed to scrape.\n\nPossible reasons: The site might block scraping, require authentication, or the URL is invalid.');
      saveHistory(url, 0, true);
      return;
    }

    // Handle new response format
    const images = data.images || data; // Support both old and new format
    const headContent = data.headContent || '';

    if (!images.length) {
      showMessage('No images found.\n\nPossible reasons: 1) Images load dynamically via JavaScript or lazy-loading. 2) Images are set as CSS backgrounds. 3) The site requires authentication/cookies. 4) The site blocks scraping tools or uses CORS restrictions.', true);
      saveHistory(url, 0, true);
      return;
    }

    buildTable(images);
    if (summaryText) summaryText.textContent = `Total Images: ${images.length}`;
    if (summaryBar) summaryBar.style.display = 'flex';
    if (inlineLabel) inlineLabel.style.display = 'inline-flex';
    if (inlineToggle) {
      inlineToggle.checked = false;
    }
    if(searchInput){
      searchInput.value='';
      searchInput.style.display='inline-block';
    }
    if(clearSearchBtn){ clearSearchBtn.style.display='inline-block';}
    
    // Display SEO metadata if feature is enabled
    if (SEO_FEATURE_ENABLED && seoDrawer && headContent) {
      seoDrawer.style.display = 'block';
      // Ensure drawer has default height when first displayed
      if (!drawerContent.style.height || drawerContent.style.height === '0px') {
        // Use requestAnimationFrame for smooth initial display
        drawerContent.style.height = '0px';
        drawerContent.style.visibility = 'visible';
        requestAnimationFrame(() => {
          drawerContent.style.transition = 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
          drawerContent.style.height = '200px';
          setTimeout(() => {
            drawerContent.style.transition = '';
          }, 250);
        });
      }
      headContentPre.innerHTML = formatAndHighlightHTML(headContent);
    }
    
    updateRowVisibility();
    saveHistory(url, images.length, false);
    table.style.display = 'table';
  } catch (err) {
    loading.style.display = 'none';
    clearInterval(loadingInterval);
    showMessage((err && err.message) ? `Error: ${err.message}.` : 'Scraping failed.\n\nPossible reasons include CORS blocks, network errors, or an invalid URL.');
    saveHistory(url, 0, true);
  }
}

function buildTable(data) {
  tbody.innerHTML = '';
  sortState = {}; // Reset sort state for new table
  data.forEach((item, idx) => {
      const tr = document.createElement('tr');

      // Preview with magnifier overlay
      const previewTd = document.createElement('td');
      const container = document.createElement('div');
      container.className = 'preview-container';
      if (!item.inline) {
        container.style.cursor = 'pointer';
      }

      let previewEl;
      if (item.inline) {
        // Embed SVG directly for preview (sanitized)
        container.innerHTML = DOMPurify.sanitize(item.content, { SAFE_FOR_SVG: true });
        const svgTag = container.querySelector('svg');
        if (svgTag) {
          svgTag.removeAttribute('width');
          svgTag.removeAttribute('height');
          svgTag.style.width = '100%';
          svgTag.style.height = '100%';
          svgTag.setAttribute('preserveAspectRatio','xMidYMid meet');
        }
      } else {
        const isSvg = (item.type && String(item.type).toLowerCase() === 'svg') || (item.url && item.url.toLowerCase().endsWith('.svg'));
        if (isSvg) {
          previewEl = document.createElement('img');
          previewEl.src = item.url;
          previewEl.alt = '';
        } else {
          previewEl = document.createElement('img');
          previewEl.src = item.url;
          previewEl.alt = '';
        }
      }
      if (previewEl) container.appendChild(previewEl);

      if (!item.inline) {
        // transparent overlay to capture clicks (works for <object>)
        const clickLayer = document.createElement('div');
        clickLayer.className = 'click-layer';
        container.appendChild(clickLayer);

        const handleOpen = () => {
          window.open(item.url, '_blank');
        };

        clickLayer.addEventListener('click', handleOpen);
        if (previewEl) previewEl.addEventListener('click', handleOpen);

        const zoomIcon = document.createElement('span');
        zoomIcon.className = 'zoom-icon';
        zoomIcon.textContent = '🔍';
        zoomIcon.setAttribute('data-tooltip', 'Open image in new tab');
        zoomIcon.addEventListener('click', handleOpen);
        container.appendChild(zoomIcon);
      }

      previewTd.appendChild(container);
      tr.appendChild(previewTd);

      // File name
      const fname = item.inline ? '-' : (item.filename && item.filename !== '-' ? item.filename : (item.url ? (item.url.split('/').pop().split(/[?#]/)[0] || 'image') : '-'));
      tr.appendChild(createTextTd(fname));

      // Alt text
      const altText = item.alt || '-';
      const altTd = createTextTd(altText);
      if (altText === '-') {
        altTd.classList.add('no-alt');
      }
      tr.appendChild(altTd);

      // Width, Height, Size, Type
      tr.appendChild(createTextTd(item.width));
      tr.appendChild(createTextTd(item.height));
      const sizeText = typeof item.size === 'number' ? (item.size / 1024).toFixed(1) : '-';
      tr.appendChild(createTextTd(sizeText));
      tr.appendChild(createTextTd(item.type));

      // Actions
      const actionTd = document.createElement('td');

      // Copy
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn-copy';
      copyBtn.textContent = 'Copy';
      // Tooltip based on image type
      if (item.inline) {
        copyBtn.setAttribute('data-tooltip', 'Copy SVG code');
      } else {
        copyBtn.setAttribute('data-tooltip', 'Copy image url');
      }
      if (item.inline) {
        copyBtn.addEventListener('click', () => navigator.clipboard.writeText(item.content));
      } else {
        copyBtn.addEventListener('click', () => navigator.clipboard.writeText(item.url));
      }

      actionTd.appendChild(copyBtn);

      if (!item.inline) {
        // Download button only for remote images
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn btn-download';
        downloadBtn.textContent = 'Download';
        downloadBtn.setAttribute('data-tooltip', 'Download image');
        downloadBtn.addEventListener('click', () => {
          window.open(`/api/download?imgUrl=${encodeURIComponent(item.url)}`, '_blank');
        });
        actionTd.appendChild(downloadBtn);
      }

      tr.appendChild(actionTd);

      // set dataset for filter
      tr.dataset.inline = item.inline ? 'true' : 'false';
      tbody.appendChild(tr);
  });
  // Re-initialize sortable headers after building new table
  initSortable();
}

// init history list on load
loadHistory();
updateClearHistoryBtn();

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
let currentTheme = localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light');

function applyTheme(mode) {
  if (mode === 'dark') {
    document.body.classList.add('dark');
    themeToggle.textContent = 'LIGHT';
  } else {
    document.body.classList.remove('dark');
    themeToggle.textContent = 'DARK';
  }
  currentTheme = mode;
  localStorage.setItem('theme', mode);
  refreshMessageColor();
}

// helper to update message color after theme toggle
function refreshMessageColor() {
  if (messageBox.style.display === 'none') return;
  const isErr = messageBox.classList.contains('error');
  const isDark = document.body.classList.contains('dark');
  if (isErr) {
    messageBox.style.color = isDark ? '#f55' : 'red';
  } else {
    messageBox.style.color = isDark ? '#e6e6e6' : 'black';
  }
}

applyTheme(currentTheme);

themeToggle.addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('website-url').value.trim();
  if (!url) return;

  handleScrape(url, true);
});

function createTextTd(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// Sorting functionality
let sortState = {}; // Track sort state for each column

function initSortable() {
  const headers = table.querySelectorAll('th[data-sort]');
  headers.forEach((header, headerIndex) => {
    header.style.cursor = 'pointer';
    
    // Remove any existing click listeners
    const newHeader = header.cloneNode(true);
    header.parentNode.replaceChild(newHeader, header);
    
    newHeader.addEventListener('click', () => {
      const index = Array.from(newHeader.parentNode.children).indexOf(newHeader);
      
      // Toggle sort order
      if (!sortState[index] || sortState[index] === 'desc') {
        sortState[index] = 'asc';
      } else {
        sortState[index] = 'desc';
      }
      
      // Update visual indicator (optional)
      document.querySelectorAll('th[data-sort]').forEach(h => {
        h.textContent = h.textContent.replace(' ↑', '').replace(' ↓', '');
      });
      newHeader.textContent = newHeader.textContent + (sortState[index] === 'asc' ? ' ↑' : ' ↓');
      
      sortTable(index, sortState[index] === 'asc');
    });
  });
} 

function sortTable(columnIndex, ascending) {
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  rows.sort((a, b) => {
    const aText = a.children[columnIndex].textContent;
    const bText = b.children[columnIndex].textContent;
    
    const aNum = parseFloat(aText);
    const bNum = parseFloat(bText);
    
    let result;
    if (!isNaN(aNum) && !isNaN(bNum)) {
      result = aNum - bNum;
    } else {
      result = aText.localeCompare(bText);
    }
    
    return ascending ? result : -result;
  });
  
  // Re-append rows in sorted order
  tbody.innerHTML = '';
  rows.forEach(row => tbody.appendChild(row));
  
  // Update visibility after sorting
  updateRowVisibility();
}

// Initialize sortable headers once on page load
document.addEventListener('DOMContentLoaded', () => {
  initSortable();
  
  // Initialize drawer toggle functionality
  if (drawerToggle && drawerContent) {
    // Store the original height
    const defaultHeight = '200px';
    let isAnimating = false;
    
    // Smooth toggle function
    const toggleDrawer = (open) => {
      if (isAnimating) return;
      isAnimating = true;
      
      if (open) {
        // Opening
        drawerContent.classList.remove('collapsed');
        drawerToggle.classList.remove('collapsed');
        drawerToggle.textContent = '▼';
        drawerContent.style.visibility = 'visible';
        
        // Force reflow for smooth animation
        void drawerContent.offsetHeight;
        
        // Animate open
        drawerContent.style.transition = 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        drawerContent.style.height = defaultHeight;
        
        setTimeout(() => {
          drawerContent.style.transition = '';
          isAnimating = false;
        }, 250);
      } else {
        // Closing
        drawerContent.style.transition = 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        drawerContent.style.height = '0px';
        
        setTimeout(() => {
          drawerContent.classList.add('collapsed');
          drawerToggle.classList.add('collapsed');
          drawerToggle.textContent = '▶';
          drawerContent.style.visibility = 'hidden';
          drawerContent.style.transition = '';
          isAnimating = false;
        }, 250);
      }
    };
    
    // Add resize observer for smooth resize tracking
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver((entries) => {
        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
          // Smooth resize handling without forced reflows
        });
      });
      resizeObserver.observe(drawerContent);
    }
    
    drawerToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = drawerContent.classList.contains('collapsed');
      toggleDrawer(isCollapsed);
    });
    
    // Allow clicking on header to toggle (but not on buttons)
    const drawerHeader = document.querySelector('.drawer-header');
    if (drawerHeader) {
      drawerHeader.addEventListener('click', (e) => {
        // Only toggle if not clicking on buttons
        if (!e.target.closest('button')) {
          const isCollapsed = drawerContent.classList.contains('collapsed');
          toggleDrawer(isCollapsed);
        }
      });
    }
  }
  
  // Initialize copy button
  if (copyDrawerBtn) {
    copyDrawerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const content = headContentPre.textContent || '';
      navigator.clipboard.writeText(content).then(() => {
        const originalText = copyDrawerBtn.textContent;
        copyDrawerBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyDrawerBtn.textContent = originalText;
        }, 1500);
      });
    });
  }
});

// Helper function to format head content for better readability
function formatHeadContent(html) {
  // Basic formatting - you can enhance this further
  return html
    .replace(/></g, '>\n<')
    .replace(/(\s+)([a-zA-Z-]+)=/g, '\n$1$2=')
    .trim();
}

// Enhanced function to format and add syntax highlighting
function formatAndHighlightHTML(html) {
  // First format the HTML for readability
  const formatted = html
    .replace(/></g, '>\n<')
    .replace(/\s*\/>/g, ' />')
    .trim();
  
  // Split into lines
  const lines = formatted.split('\n');
  
  // For performance, limit syntax highlighting to first 500 lines
  const maxLinesToHighlight = 500;
  const shouldTruncate = lines.length > maxLinesToHighlight;
  const linesToProcess = shouldTruncate ? lines.slice(0, maxLinesToHighlight) : lines;
  
  // Process each line with syntax highlighting
  const highlightedLines = linesToProcess.map(line => {
    let highlighted = line;
    
    // Escape HTML entities for display
    highlighted = highlighted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Skip highlighting for very long lines (performance)
    if (highlighted.length > 1000) {
      return `<span class="code-line">${highlighted}</span>`;
    }
    
    // Highlight comments
    highlighted = highlighted.replace(
      /(&lt;!--.*?--&gt;)/g,
      '<span class="comment">$1</span>'
    );
    
    // Highlight doctype
    highlighted = highlighted.replace(
      /(&lt;!DOCTYPE.*?&gt;)/gi,
      '<span class="doctype">$1</span>'
    );
    
    // Highlight tags with attributes
    highlighted = highlighted.replace(
      /(&lt;)(\/?)(\w+)(.*?)(\/?&gt;)/g,
      (match, lt, slash, tagName, attrs, gt) => {
        // Process attributes
        const highlightedAttrs = attrs.replace(
          /(\s+)([\w-]+)(=)(["'])(.*?)\4/g,
          '$1<span class="attribute">$2</span>$3<span class="attribute-value">$4$5$4</span>'
        );
        
        return `<span class="tag-bracket">${lt}</span>${slash}<span class="tag-name">${tagName}</span>${highlightedAttrs}<span class="tag-bracket">${gt}</span>`;
      }
    );
    
    return `<span class="code-line">${highlighted}</span>`;
  });
  
  // Add truncation notice if needed
  if (shouldTruncate) {
    highlightedLines.push(`<span class="code-line comment">... (${lines.length - maxLinesToHighlight} more lines)</span>`);
  }
  
  return highlightedLines.join('\n');
} 