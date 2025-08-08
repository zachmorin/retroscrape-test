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
const debugPanel = document.getElementById('debug-panel');
const debugToggle = document.getElementById('debug-toggle');
const staticStatus = document.getElementById('static-status');
const dynamicStatus = document.getElementById('dynamic-status');
const methodUsed = document.getElementById('method-used');
const fallbackUsed = document.getElementById('fallback-used');
// Tabs elements
const tabsBar = document.getElementById('tabs-bar');
const tabsList = document.getElementById('tabs-list');
const clearTabsBtn = document.getElementById('clear-tabs');
let loadingInterval;

// Feature toggle - set to false to disable SEO metadata feature
const SEO_FEATURE_ENABLED = seoDrawer ? seoDrawer.dataset.featureEnabled === 'true' : false;

// Debug feature toggle - reads from HTML data attribute
const DEBUG_FEATURE_ENABLED = debugPanel ? debugPanel.dataset.featureEnabled === 'true' : false;

// Debug panel functions
function showDebugPanel() {
  if (debugPanel) {
    debugPanel.style.display = 'block';
  }
}

function hideDebugPanel() {
  if (debugPanel) {
    debugPanel.style.display = 'none';
  }
}

function updateDebugPanel(debug, scrapingMethod, fallbackUsedFlag, warning) {
  if (!debugPanel) return;
  
  // Use debug data from backend if available
  const staticAttempted = debug.staticAttempted || false;
  const dynamicAttempted = debug.dynamicAttempted || false;
  const staticSuccess = debug.staticSuccess || false;
  const dynamicSuccess = debug.dynamicSuccess || false;
  
  // Update status indicators
  if (staticStatus) {
    if (staticAttempted) {
      staticStatus.textContent = staticSuccess ? 'Successful' : 'Failed';
      staticStatus.className = `debug-status ${staticSuccess ? 'success' : 'failed'}`;
    } else {
      staticStatus.textContent = 'Not Attempted';
      staticStatus.className = 'debug-status not-attempted';
    }
  }
  
  if (dynamicStatus) {
    if (dynamicAttempted) {
      dynamicStatus.textContent = dynamicSuccess ? 'Successful' : 'Failed';
      dynamicStatus.className = `debug-status ${dynamicSuccess ? 'success' : 'failed'}`;
    } else {
      dynamicStatus.textContent = 'Not Attempted';
      dynamicStatus.className = 'debug-status not-attempted';
    }
  }
  
  if (methodUsed) {
    methodUsed.textContent = scrapingMethod || 'Unknown';
    methodUsed.className = 'debug-method';
  }
  
  if (fallbackUsed) {
    const usedFallback = fallbackUsedFlag || false;
    fallbackUsed.textContent = usedFallback ? 'Yes' : 'No';
    fallbackUsed.className = `debug-fallback ${usedFallback ? 'yes' : 'no'}`;
  }
  
  showDebugPanel();
}

// Debug panel toggle
if (debugToggle) {
  debugToggle.addEventListener('click', () => {
    hideDebugPanel();
  });
}

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
  // Update active tab filtered count for badge
  const tab = getActiveTab();
  if (tab) {
    let visible=0;
    tbody.querySelectorAll('tr').forEach(tr=>{ if(tr.style.display!== 'none') visible++; });
    tab.view = tab.view || { searchTerm:'', showInline:false };
    tab.view.filteredCount = visible;
    renderTabs();
  }
}

if(searchInput){
  searchInput.addEventListener('input', ()=>{ updateRowVisibility(); });
  // Persist per-tab search term and update badge
  searchInput.addEventListener('input', ()=>{
    const tab = getActiveTab();
    if (tab) {
      tab.view = tab.view || { searchTerm:'', showInline:false };
      tab.view.searchTerm = searchInput.value;
      let visible=0;
      tbody.querySelectorAll('tr').forEach(tr=>{ if(tr.style.display!== 'none') visible++; });
      tab.view.filteredCount = visible;
      renderTabs();
    }
  });
}

if (inlineToggle) {
  inlineToggle.addEventListener('change', () => {
    const tab = getActiveTab();
    if (tab) {
      tab.view = tab.view || { searchTerm:'', showInline:false };
      tab.view.showInline = inlineToggle.checked;
    }
    updateRowVisibility();
  });
}

if(clearSearchBtn){
  clearSearchBtn.addEventListener('click', ()=>{
    if(searchInput){searchInput.value='';}
    updateRowVisibility();
  });
  clearSearchBtn.disabled = true;
}

// Resolve possibly relative URLs on the client to improve display robustness
function resolveClientUrl(base, src) {
  try {
    if (!src) return src;
    const trimmed = String(src).trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return trimmed;
    if (trimmed.startsWith('//')) {
      const baseUrl = new URL(base);
      return `${baseUrl.protocol}${trimmed}`;
    }
    return new URL(trimmed, base).href;
  } catch (_) {
    return src; // fall back to original if resolution fails
  }
}

// ----------------------
// Tabs state management
// ----------------------
let tabs = [];
let activeTabId = null;
let inFlightControllers = new Map(); // tabId -> AbortController

function createTabId(){
  return 'tab-' + Math.random().toString(36).slice(2,9);
}

function getActiveTab(){
  return tabs.find(t=>t.id===activeTabId) || null;
}

function findLoadingTabByUrl(targetUrl){
  return tabs.find(t => t.status === 'loading' && t.url === targetUrl) || null;
}

function tabLabelFromUrl(url){
  const MAX_LEN = 30;
  const text = String(url || '');
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '...' : text;
}

function truncateText(text, maxLen = 30) {
  const t = String(text || '');
  return t.length > maxLen ? t.slice(0, maxLen) + '...' : t;
}

function extractPageTitleFromHead(headHtml) {
  if (!headHtml) return '';
  try {
    const titleMatch = headHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }
    const ogMatch = headHtml.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (ogMatch && ogMatch[1]) {
      return ogMatch[1].trim();
    }
    const twitterMatch = headHtml.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (twitterMatch && twitterMatch[1]) {
      return twitterMatch[1].trim();
    }
  } catch {}
  return '';
}

function ensureTabsBarVisible(){
  if (!tabsBar) return;
  tabsBar.style.display = tabs.length > 0 ? 'flex' : 'none';
}

function renderTabs(){
  if (!tabsList) return;
  tabsList.innerHTML='';
  tabs.forEach(t=>{
    const el = document.createElement('div');
    el.className = 'tab-item' + (t.id===activeTabId ? ' active' : '');
    el.title = t.url;

    const status = document.createElement('span');
    status.className = 'tab-status ' + (t.status||'');
    el.appendChild(status);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = t.label || tabLabelFromUrl(t.url);
    el.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    const shown = (t.view && typeof t.view.filteredCount==='number') ? t.view.filteredCount : (t.images? t.images.length: 0);
    badge.textContent = String(shown);
    el.appendChild(badge);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.addEventListener('click', (e)=>{ e.stopPropagation(); closeTab(t.id); });
    el.appendChild(close);

    el.addEventListener('click', ()=>{ switchTab(t.id); });
    tabsList.appendChild(el);
  });
  ensureTabsBarVisible();
  persistTabs();
}

function switchTab(id){
  activeTabId = id;
  renderTabs();
  const tab = getActiveTab();
  if (!tab) return;
  // Update UI according to tab view state
  tbody.innerHTML='';
  if (tab.status==='loading') {
    loading.style.display='block';
  } else {
    loading.style.display='none';
    // Ensure non-error (info) messages don't linger once loading is finished
    if (tab.messageText && !tab.messageIsError) {
      delete tab.messageText;
      delete tab.messageIsError;
      persistTabs();
    }
  }
  // Summary/search controls
  if (summaryBar) summaryBar.style.display = tab.images && tab.images.length ? 'flex' : 'none';
  if (inlineLabel) inlineLabel.style.display = tab.images && tab.images.length ? 'inline-flex' : 'none';
  if (searchInput) {
    searchInput.style.display = tab.images && tab.images.length ? 'inline-block' : 'none';
    searchInput.value = (tab.view && tab.view.searchTerm) || '';
  }
  if (inlineToggle) {
    inlineToggle.checked = !!(tab.view && tab.view.showInline);
  }
  if (tab.images && tab.images.length) {
    buildTable(tab.images);
    updateRowVisibility();
    if (summaryText) summaryText.textContent = `Total Images: ${tab.images.length}`;
    table.style.display='table';
  } else {
    table.style.display='none';
  }
  // SEO head content drawer per-tab
  if (SEO_FEATURE_ENABLED && seoDrawer) {
    if (tab.headContent && tab.headContent.length > 0) {
      seoDrawer.style.display = 'block';
      if (headContentPre) {
        headContentPre.innerHTML = formatAndHighlightHTML(tab.headContent);
      }
    } else {
      seoDrawer.style.display = 'none';
      if (headContentPre) headContentPre.innerHTML = '';
    }
  }
  // Debug (if present in response)
  if (DEBUG_FEATURE_ENABLED && tab.debug) {
    updateDebugPanel(tab.debug, tab.scrapingMethod, tab.fallbackUsed, tab.warning);
  } else {
    hideDebugPanel();
  }
  // Show tab-specific message (persist while loading or error)
  if (tab.messageText) {
    showMessage(tab.messageText, !!tab.messageIsError);
  } else {
    clearMessage();
  }
}

function closeTab(id){
  // Abort if in-flight
  const ctrl = inFlightControllers.get(id);
  if (ctrl){ try { ctrl.abort(); } catch {}
    inFlightControllers.delete(id);
  }
  const idx = tabs.findIndex(t=>t.id===id);
  if (idx===-1) return;
  tabs.splice(idx,1);
  if (activeTabId===id){
    const newIdx = Math.max(0, idx-1);
    activeTabId = tabs[newIdx]?.id || null;
  }
  renderTabs();
  if (activeTabId){ switchTab(activeTabId); }
  else {
    // Clear UI when no tabs
    tbody.innerHTML='';
    table.style.display='none';
    if (summaryBar) summaryBar.style.display='none';
    if (inlineLabel) inlineLabel.style.display='none';
    loading.style.display='none';
    hideDebugPanel();
  }
}

function createOrReuseTab(url){
  // Reuse active empty/error tab; otherwise create new
  // If a loading tab already exists for this URL, reuse it to prevent duplicates
  const loadingExisting = findLoadingTabByUrl(url);
  if (loadingExisting) {
    activeTabId = loadingExisting.id;
    renderTabs();
    switchTab(loadingExisting.id);
    return loadingExisting;
  }

  let tab = getActiveTab();
  if (!tab || (tab.images && tab.images.length) || tab.status==='loading'){
    // Enforce max tabs (4)
    if (tabs.length >= 4) {
      showMessage('Maximum of 4 tabs reached. Please close a tab to open a new one.', true);
      return null;
    }
    tab = {
      id: createTabId(),
      url,
      label: tabLabelFromUrl(url),
      status: 'loading',
      images: [],
      headContent: '',
      view: { searchTerm:'', showInline:false },
      scrapingMethod: '-',
      fallbackUsed: false
    };
    tabs.push(tab);
    activeTabId = tab.id;
  } else {
    tab.url = url;
    tab.label = tabLabelFromUrl(url);
    tab.status = 'loading';
    tab.images = [];
    tab.headContent = '';
    hideDebugPanel();
  }
  renderTabs();
  switchTab(tab.id);
  return tab;
}

// ----------
// Persistence
// ----------
const TABS_STORAGE_KEY = 'retroscrape_tabs_v1';

function persistTabs(){
  try {
    const payload = {
      activeTabId,
      tabs: tabs.map(t => ({
        id: t.id,
        url: t.url,
        label: t.label,
        status: t.status,
        // To limit storage size, cap images per tab (metadata only)
        images: Array.isArray(t.images) ? t.images.slice(0, 200) : [],
        headContent: t.headContent,
        view: t.view,
        scrapingMethod: t.scrapingMethod,
        fallbackUsed: t.fallbackUsed,
        debug: t.debug || null
      }))
    };
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

function restoreTabs(){
  try {
    const str = localStorage.getItem(TABS_STORAGE_KEY);
    if (!str) return;
    const payload = JSON.parse(str);
    if (!payload || !Array.isArray(payload.tabs)) return;
    tabs = payload.tabs.map(t => ({
      ...t,
      label: truncateText(extractPageTitleFromHead(t.headContent) || t.label || tabLabelFromUrl(t.url), 30)
    }));
    activeTabId = payload.activeTabId || (tabs[0] && tabs[0].id) || null;
    renderTabs();
    if (activeTabId) switchTab(activeTabId);
  } catch {}
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
  // Persist on active tab so it survives tab switching
  const tab = getActiveTab();
  if (tab) {
    tab.messageText = text;
    tab.messageIsError = !!isError;
    persistTabs();
  }
}

function clearMessage() {
  messageBox.style.display = 'none';
  // Clear on active tab only
  const tab = getActiveTab();
  if (tab) {
    delete tab.messageText;
    delete tab.messageIsError;
    persistTabs();
  }
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
    const MAX_LEN = 40;
    const displayText = link.length > MAX_LEN ? link.slice(0, MAX_LEN) + '...' : link;
    a.textContent = `${count != null ? '[' + count + '] ' : ''}${displayText}`;
    a.title = link;
    if (isErr) a.classList.add('error-link');
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById('website-url').value = link;
      // Show helpful message immediately when initiating via history
      showMessage('Large pages with many images may take longer to load.', false);
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
async function handleScrape(url, includeLazy = true, dynamicMode = 'auto') {
  // If a scrape for this URL is already in progress, focus that tab and exit
  const existingLoading = findLoadingTabByUrl(url);
  if (existingLoading && inFlightControllers.has(existingLoading.id)) {
    activeTabId = existingLoading.id;
    renderTabs();
    switchTab(existingLoading.id);
    return;
  }
  // Init/assign tab
  const tab = createOrReuseTab(url);
  if (!tab || !tab.id) {
    // Could not create due to max tabs; bail out
    return;
  }
  if (seoDrawer && SEO_FEATURE_ENABLED) seoDrawer.style.display = 'none';
  // Set loading info message on this tab and show it
  tab.messageText = 'Large pages with many images may take longer to load.';
  tab.messageIsError = false;
  showMessage(tab.messageText, tab.messageIsError);
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
    const controller = new AbortController();
    inFlightControllers.set(tab.id, controller);
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, lazy: includeLazy, dynamic: dynamicMode }),
      signal: controller.signal
    });
    const data = await res.json();
    inFlightControllers.delete(tab.id);
    loading.style.display = 'none';
    clearInterval(loadingInterval);
    // Clear info message when request completes; keep errors
    if (!tab.messageIsError) {
      delete tab.messageText;
      delete tab.messageIsError;
      clearMessage();
    }

    if (!res.ok) {
      tab.status = 'error';
      showMessage(data.error || 'Failed to scrape.\n\nPossible reasons: The site might block scraping, require authentication, or the URL is invalid.', true);
      // Only show debug panel if debug data is present and feature is enabled
      if (DEBUG_FEATURE_ENABLED && data.debug) {
        tab.debug = data.debug;
        tab.scrapingMethod = data.scrapingMethod;
        tab.fallbackUsed = data.fallbackUsed;
        updateDebugPanel(tab.debug, tab.scrapingMethod, tab.fallbackUsed, data.errorMessage);
      }
      saveHistory(url, 0, true);
      renderTabs();
      if (activeTabId === tab.id) {
        switchTab(tab.id);
      }
      return;
    }

    // Handle new response format
    const images = data.images || data; // Support both old and new format
    const headContent = data.headContent || '';

    // Only show debug panel if debug data is present and feature is enabled
    if (DEBUG_FEATURE_ENABLED && data.debug) {
      tab.debug = data.debug;
      tab.scrapingMethod = data.scrapingMethod;
      tab.fallbackUsed = data.fallbackUsed;
      updateDebugPanel(tab.debug, tab.scrapingMethod, tab.fallbackUsed, data.warning);
    }

    if (!images.length) {
      tab.status = 'done';
      tab.images = [];
      showMessage('No images found.\n\nPossible reasons: 1) Images load dynamically via JavaScript or lazy-loading. 2) Images are set as CSS backgrounds. 3) The site requires authentication/cookies. 4) The site blocks scraping tools or uses CORS restrictions.', true);
      saveHistory(url, 0, true);
      renderTabs();
      switchTab(tab.id);
      return;
    }

    // Normalize any remaining relative URLs on the client using the page URL
    const normalizedImages = images.map(item => {
      if (!item || item.inline) return item;
      const fixedUrl = resolveClientUrl(url, item.url);
      if (fixedUrl && fixedUrl !== item.url) {
        const updated = { ...item, url: fixedUrl };
        if (!item.filename || item.filename === '-') {
          const fname = fixedUrl.split('/').pop().split(/[?#]/)[0] || 'image';
          updated.filename = fname;
        }
        return updated;
      }
      return item;
    });

    tab.status = 'done';
    tab.images = normalizedImages;
    tab.headContent = headContent;
    // Update tab label to page title (truncate to 30) if available
    const extractedTitle = extractPageTitleFromHead(headContent);
    if (extractedTitle) {
      tab.label = truncateText(extractedTitle, 30);
    } else {
      tab.label = tabLabelFromUrl(url);
    }
    tab.view = tab.view || { searchTerm:'', showInline:false };
    // Initialize per-tab controls
    if (inlineToggle) inlineToggle.checked = !!tab.view.showInline;
    if (searchInput) {
      searchInput.value = tab.view.searchTerm || '';
      searchInput.style.display='inline-block';
    }
    if(clearSearchBtn){ clearSearchBtn.style.display='inline-block'; }
    
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
    
    renderTabs();
    if (activeTabId === tab.id) {
      switchTab(tab.id);
    }
    updateRowVisibility();
    saveHistory(url, images.length, false);
    table.style.display = 'table';
  } catch (err) {
    loading.style.display = 'none';
    clearInterval(loadingInterval);
    const tab = getActiveTab();
    if (err && err.name === 'AbortError') {
      // User closed tab or switched; do not show error
      if (tab) { tab.status = 'error'; renderTabs(); }
    } else {
      if (tab) tab.status = 'error';
      showMessage((err && err.message) ? `Error: ${err.message}.` : 'Scraping failed.\n\nPossible reasons include CORS blocks, network errors, or an invalid URL.', true);
      saveHistory(url, 0, true);
      renderTabs();
      if (tab && activeTabId === tab.id) switchTab(tab.id);
    }
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
  
  // (History click is handled directly in renderHistory for each link)
  
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

  // New tab via '+' is disabled/removed; tabs are created only via URL form submit or history link click.
  // Clear all tabs button
  if (typeof clearTabsBtn !== 'undefined' && clearTabsBtn) {
    clearTabsBtn.addEventListener('click', () => {
      // Abort in-flight
      for (const [id, ctrl] of inFlightControllers.entries()) { try { ctrl.abort(); } catch {} }
      inFlightControllers.clear();
      tabs = [];
      activeTabId = null;
      renderTabs();
      // Clear UI
      tbody.innerHTML='';
      table.style.display='none';
      if (summaryBar) summaryBar.style.display='none';
      if (inlineLabel) inlineLabel.style.display='none';
      // Ensure SEO drawer is hidden and cleared when tabs are cleared
      if (seoDrawer) {
        seoDrawer.style.display = 'none';
        if (headContentPre) headContentPre.innerHTML = '';
      }
      loading.style.display='none';
      hideDebugPanel();
      persistTabs();
    });
  }
  // Restore persisted tabs on load
  restoreTabs();
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