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
let loadingInterval;

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

document.getElementById('clear-history').addEventListener('click', ()=>{
  localStorage.removeItem('scraperHistory');
  document.cookie='scraperHistory=;path=/;max-age=0';
  historyList.innerHTML='';
});

// helper to handle response
async function handleScrape(url, includeLazy = true) {
  tbody.innerHTML = '';
  table.style.display = 'none';
  if (summaryBar) summaryBar.style.display = 'none';
  if (inlineLabel) inlineLabel.style.display = 'none';
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

    if (!data.length) {
      showMessage('No images found.\n\nPossible reasons: 1) Images load dynamically via JavaScript or lazy-loading. 2) Images are set as CSS backgrounds. 3) The site requires authentication/cookies. 4) The site blocks scraping tools or uses CORS restrictions.', true);
      saveHistory(url, 0, true);
      return;
    }

    buildTable(data);
    if (summaryText) summaryText.textContent = `Total Images: ${data.length}`;
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
    updateRowVisibility();
    saveHistory(url, data.length, false);
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
        container.appendChild(zoomIcon);
      }

      previewTd.appendChild(container);
      tr.appendChild(previewTd);

      // File name
      const fname = item.inline ? '-' : (item.filename && item.filename !== '-' ? item.filename : (item.url ? (item.url.split('/').pop().split(/[?#]/)[0] || 'image') : '-'));
      tr.appendChild(createTextTd(fname));

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
  makeSortable();
}

// init history list on load
loadHistory();

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
function makeSortable() {
  const headers = table.querySelectorAll('th[data-sort]');
  headers.forEach(header => {
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const index = Array.from(header.parentNode.children).indexOf(header);
      const ascending = header.dataset.order !== 'asc';
      header.dataset.order = ascending ? 'asc' : 'desc';

      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const aText = a.children[index].textContent;
        const bText = b.children[index].textContent;

        const aNum = parseFloat(aText);
        const bNum = parseFloat(bText);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return ascending ? aNum - bNum : bNum - aNum;
        }
        return ascending ? aText.localeCompare(bText) : bText.localeCompare(aText);
      });

      tbody.innerHTML = '';
      rows.forEach(r => tbody.appendChild(r));
    });
  });
} 