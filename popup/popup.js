// ── UI Theme ─────────────────────────────────────────────────
// 'win98'  →  Windows 98 经典风格 (默认)
// 'google' →  现代圆角 Google 美学
//const THEME = 'win98';
const THEME = 'google';

const DEFAULT_LIBRARIES = [
  { id: '98-css',   name: 'win98',      url: '',                                                          enabled: false, builtin: true, description: 'Windows 98' },
  { id: 'pet-terminal', name: 'PET Terminal', url: '',                                                     enabled: false, builtin: true,  },
  { id: 'win7-glass', name: 'Win7 Glass', url: '',                                                          enabled: false, builtin: true,  },
  { id: 'system-css', name: 'system.css', url: '',                                                          enabled: false, builtin: true,  },
  { id: 'xp-css',   name: 'XP.css',     url: '',                                                          enabled: false, builtin: true,  },
  { id: 'mac-osx',   name: 'Mac OS X',   url: '',                                                          enabled: false, builtin: true, },
  { id: 'woodblock-css', name: 'Woodblock Print', url: '',                                                 enabled: false, builtin: true },
  { id: 'lcd',          name: 'LCD',             url: '',                                                 enabled: false, builtin: true, description: 'LCD display: sage green bg, dark brown text' }

];

const DEFAULTS = {
  enabled: false,
  darkMode: 'off',
  bgEnabled: false,       backgroundColor: '#bebebe',
  textEnabled: false,     textColor: '#000000',
  fontFamilyEnabled: false, fontFamily: 'system-ui, sans-serif',
  fontSizeEnabled: false, fontSize: 16,
  globalRadiusEnabled: false,
  globalRadius: 8,
  customCSS: '',
  cssLibraries: DEFAULT_LIBRARIES,
  chaosIntensity: 0,
  smartDarkContrast: 75,
  dimAmount: 30,
  pageFlipEnabled: false,
  treeStructureEnabled: false,
  gothicEnabled: false,
  petTerminalFilterMedia: true,
  petTerminalNoGlow: false,
  lcdFilterMedia: false,
  pauseVideosEnabled: false,
  disabledSites: [],
  siteSettings: {},
};

/* ── Per-site settings keys ──────────────── */
const SITE_KEYS = new Set([
  'darkMode','smartDarkContrast','dimAmount',
  'bgEnabled','backgroundColor','textEnabled','textColor',
  'fontFamilyEnabled','fontFamily','fontSizeEnabled','fontSize',
  'globalRadiusEnabled','globalRadius',
  'customCSS','chaosIntensity',
  'pageFlipEnabled','treeStructureEnabled','gothicEnabled',
  'petTerminalFilterMedia','petTerminalNoGlow','lcdFilterMedia',
  'pauseVideosEnabled',
  'cssLibraries',
]);

function extractSiteSettings(src) {
  const s = {};
  SITE_KEYS.forEach(k => { s[k] = src[k]; });
  return s;
}

function effectiveState() {
  if (siteOnlyActive && currentSite && state.siteSettings?.[currentSite]) {
    return { ...state, ...state.siteSettings[currentSite] };
  }
  return state;
}

let state = { ...DEFAULTS };
let saveTimer = null;
let currentSite = null;
let siteOnlyActive = false;

function mergeLibraries(libraries = []) {
  const byId = new Map(libraries.map(lib => [lib.id, lib]));
  const builtins = DEFAULT_LIBRARIES.map(defaultLib => ({
    ...defaultLib,
    enabled: byId.get(defaultLib.id)?.enabled ?? defaultLib.enabled,
  }));
  const custom = libraries.filter(lib => !DEFAULT_LIBRARIES.some(defaultLib => defaultLib.id === lib.id));
  return [...builtins, ...custom];
}

/* ── Storage helpers ─────────────────────── */

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(null, data => {
      const result = { ...DEFAULTS, ...data };
      result.cssLibraries = mergeLibraries(result.cssLibraries || []);
      if (!Array.isArray(result.disabledSites)) {
        result.disabledSites = [];
      }
      if (!result.siteSettings || typeof result.siteSettings !== 'object' || Array.isArray(result.siteSettings)) {
        result.siteSettings = {};
      }
      resolve(result);
    });
  });
}

function saveNow(updates = {}) {
  if (siteOnlyActive && currentSite) {
    if (!state.siteSettings[currentSite]) state.siteSettings[currentSite] = {};
    for (const [k, v] of Object.entries(updates)) {
      if (SITE_KEYS.has(k)) state.siteSettings[currentSite][k] = v;
      else state[k] = v;
    }
  } else {
    Object.assign(state, updates);
  }
  chrome.storage.sync.set(state);
}

function saveDebounced(updates = {}) {
  if (siteOnlyActive && currentSite) {
    if (!state.siteSettings[currentSite]) state.siteSettings[currentSite] = {};
    for (const [k, v] of Object.entries(updates)) {
      if (SITE_KEYS.has(k)) state.siteSettings[currentSite][k] = v;
      else state[k] = v;
    }
  } else {
    Object.assign(state, updates);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set(state), 400);
}

function normalizeSiteHost(hostname) {
  return (hostname || '').toLowerCase().replace(/^www\./, '');
}

function siteMatches(hostname, site) {
  const host = normalizeSiteHost(hostname);
  const disabled = normalizeSiteHost(site);
  return host === disabled || host.endsWith('.' + disabled);
}

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url || '');
    if (!/^https?:$/.test(url.protocol)) return null;
    return normalizeSiteHost(url.hostname);
  } catch {
    return null;
  }
}

function updateSiteStatus() {
  const checkbox = document.getElementById('siteDisabled');
  const status = document.getElementById('site-status');
  if (!checkbox || !status) return;

  if (!currentSite) {
    checkbox.checked = false;
    checkbox.disabled = true;
    status.textContent = 'This page cannot be configured.';
    return;
  }

  checkbox.disabled = false;
  checkbox.checked = (state.disabledSites || []).some(site => siteMatches(currentSite, site));
  status.textContent = checkbox.checked
    ? `Disabled on ${currentSite}.`
    : currentSite;
}

function updateVideoPauseStatus() {
  const el = document.getElementById('pause-videos-status');
  if (!el) return;
  el.textContent = effectiveState().pauseVideosEnabled
    ? 'New videos stay paused until you click the video.'
    : '';
}

/* ── Render library list ─────────────────── */

function renderLibraries() {
  const list = document.getElementById('library-list');
  list.innerHTML = '';

  effectiveState().cssLibraries.forEach(lib => {
    const item = document.createElement('div');
    item.className = 'lib-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'lib-toggle';
    cb.checked = lib.enabled;
    cb.addEventListener('change', () => {
      const newLibraries = state.cssLibraries.map(l => ({
        ...l,
        enabled: cb.checked && l.id === lib.id
      }));
      saveNow({ cssLibraries: newLibraries });
      renderLibraries();
      updateChaosSettingsVisibility();
    });

    const info = document.createElement('div');
    info.className = 'lib-info';
    info.innerHTML = `<div class="lib-name">${lib.name}</div><div class="lib-desc">${lib.description || lib.url}</div>`;

    item.appendChild(cb);
    item.appendChild(info);

    if (!lib.builtin) {
      const del = document.createElement('button');
      del.className = 'lib-delete';
      del.title = 'Remove';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        state.cssLibraries = state.cssLibraries.filter(l => l.id !== lib.id);
        for (const site of Object.keys(state.siteSettings || {})) {
          if (Array.isArray(state.siteSettings[site]?.cssLibraries)) {
            state.siteSettings[site].cssLibraries = state.siteSettings[site].cssLibraries.filter(l => l.id !== lib.id);
          }
        }
        saveNow();
        renderLibraries();
      });
      item.appendChild(del);
    }

    list.appendChild(item);
  });
}

/* ── Sync UI from state ──────────────────── */

function applyStateToUI() {
  const $ = id => document.getElementById(id);
  const eff = effectiveState();

  $('enabled').checked = state.enabled;
  document.getElementById('body').classList.toggle('disabled', !state.enabled);
  updateSiteStatus();
  $('pauseVideosEnabled').checked = eff.pauseVideosEnabled;
  updateVideoPauseStatus();

  document.querySelectorAll('input[name=darkMode]').forEach(r => {
    r.checked = r.value === eff.darkMode;
  });

  $('bgEnabled').checked = eff.bgEnabled;
  $('backgroundColor').value = eff.backgroundColor;
  $('bgHex').textContent = eff.backgroundColor;

  $('textEnabled').checked = eff.textEnabled;
  $('textColor').value = eff.textColor;
  $('textHex').textContent = eff.textColor;

  $('fontFamilyEnabled').checked = eff.fontFamilyEnabled;
  $('fontFamily').value = eff.fontFamily;
  $('fontFamily').disabled = !eff.fontFamilyEnabled;

  $('fontSizeEnabled').checked = eff.fontSizeEnabled;
  $('fontSize').value = eff.fontSize;
  $('fontSize').disabled = !eff.fontSizeEnabled;
  $('fontSizeLabel').textContent = eff.fontSize + 'px';

  $('globalRadiusEnabled').checked = eff.globalRadiusEnabled;
  $('globalRadius').value = eff.globalRadius;
  $('globalRadius').disabled = !eff.globalRadiusEnabled;
  $('globalRadiusLabel').textContent = eff.globalRadius + 'px';
  $('customCSS').value = eff.customCSS;

  $('chaosIntensity').value = eff.chaosIntensity;
  $('chaosIntensityLabel').textContent = eff.chaosIntensity;

  $('smartDarkContrast').value = eff.smartDarkContrast;
  $('smartDarkContrastLabel').textContent = eff.smartDarkContrast;
  $('dimAmount').value = eff.dimAmount;
  $('dimAmountLabel').textContent = eff.dimAmount + '%';
  updateDarkModeOpts();

  const pfToggle = $('pageFlipEnabled');
  if (pfToggle) pfToggle.checked = eff.pageFlipEnabled;

  const tsToggle = $('treeStructureEnabled');
  if (tsToggle) tsToggle.checked = eff.treeStructureEnabled;

  const gothicToggle = $('gothicEnabled');
  if (gothicToggle) gothicToggle.checked = eff.gothicEnabled;

  $('petTerminalFilterMedia').checked = eff.petTerminalFilterMedia !== false;
  $('petTerminalNoGlow').checked = eff.petTerminalNoGlow === true;
  $('lcdFilterMedia').checked = eff.lcdFilterMedia === true;

  renderLibraries();
  updateChaosSettingsVisibility();
  updateSiteOnlyUI();
}

function updateDarkModeOpts() {
  const m = effectiveState().darkMode;
  document.getElementById('smartdark-opts').classList.toggle('hidden', m !== 'smartdark');
  document.getElementById('dim-opts').classList.toggle('hidden', m !== 'dim');
}

function updateSiteOnlyUI() {
  const cb = document.getElementById('siteOnly');
  const status = document.getElementById('site-status');
  if (!cb) return;
  cb.disabled = !currentSite;
  cb.checked = siteOnlyActive;
  if (!status) return;
  if (siteOnlyActive && currentSite) {
    status.textContent = `Site: ${currentSite}`;
    status.classList.add('site-active');
  } else {
    status.classList.remove('site-active');
  }
}

function updateChaosSettingsVisibility() {
  /* always visible — intensity now affects all modes */
}

/* ── Bind all events ─────────────────────── */

function bindEvents() {
  const $ = id => document.getElementById(id);

  $('siteOnly').addEventListener('change', e => {
    if (!currentSite) { e.target.checked = false; return; }
    siteOnlyActive = e.target.checked;
    if (siteOnlyActive) {
      if (!state.siteSettings) state.siteSettings = {};
      state.siteSettings[currentSite] = extractSiteSettings(state);
    } else {
      if (state.siteSettings) delete state.siteSettings[currentSite];
    }
    chrome.storage.sync.set(state);
    applyStateToUI();
  });

  $('siteDisabled').addEventListener('change', e => {
    if (!currentSite) {
      e.target.checked = false;
      updateSiteStatus();
      return;
    }

    const nextSites = new Set((state.disabledSites || []).map(normalizeSiteHost));
    if (e.target.checked) nextSites.add(currentSite);
    else nextSites.delete(currentSite);

    saveNow({ disabledSites: Array.from(nextSites).filter(Boolean).sort() });
    updateSiteStatus();
  });

  $('pauseVideosEnabled').addEventListener('change', e => {
    saveNow({ pauseVideosEnabled: e.target.checked });
    updateVideoPauseStatus();
  });

  /* Master toggle */
  $('enabled').addEventListener('change', e => {
    const body = $('body');
    body.classList.toggle('disabled', !e.target.checked);
    saveNow({ enabled: e.target.checked });
  });

  /* Dark mode */
  document.querySelectorAll('input[name=darkMode]').forEach(r => {
    r.addEventListener('change', () => {
      saveNow({ darkMode: r.value });
      updateDarkModeOpts();
    });
  });

  $('smartDarkContrast').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('smartDarkContrastLabel').textContent = v;
    saveDebounced({ smartDarkContrast: v });
  });

  $('dimAmount').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('dimAmountLabel').textContent = v + '%';
    saveDebounced({ dimAmount: v });
  });

  /* Background color */
  $('bgEnabled').addEventListener('change', e => {
    saveNow({ bgEnabled: e.target.checked });
  });
  $('backgroundColor').addEventListener('input', e => {
    $('bgHex').textContent = e.target.value;
    saveDebounced({ backgroundColor: e.target.value });
  });

  /* Text color */
  $('textEnabled').addEventListener('change', e => {
    saveNow({ textEnabled: e.target.checked });
  });
  $('textColor').addEventListener('input', e => {
    $('textHex').textContent = e.target.value;
    saveDebounced({ textColor: e.target.value });
  });

  /* Font family */
  $('fontFamilyEnabled').addEventListener('change', e => {
    $('fontFamily').disabled = !e.target.checked;
    saveNow({ fontFamilyEnabled: e.target.checked });
  });
  $('fontFamily').addEventListener('input', e => {
    saveDebounced({ fontFamily: e.target.value });
  });

  /* Font size */
  $('fontSizeEnabled').addEventListener('change', e => {
    $('fontSize').disabled = !e.target.checked;
    saveNow({ fontSizeEnabled: e.target.checked });
  });
  $('fontSize').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('fontSizeLabel').textContent = v + 'px';
    saveDebounced({ fontSize: v });
  });

  $('globalRadiusEnabled').addEventListener('change', e => {
    $('globalRadius').disabled = !e.target.checked;
    saveNow({ globalRadiusEnabled: e.target.checked });
  });
  $('globalRadius').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('globalRadiusLabel').textContent = v + 'px';
    saveDebounced({ globalRadius: v });
  });

  /* Swap colors */
  $('swap-colors-btn').addEventListener('click', () => {
    const bg = $('backgroundColor').value;
    const tc = $('textColor').value;
    $('backgroundColor').value = tc;
    $('bgHex').textContent = tc;
    $('textColor').value = bg;
    $('textHex').textContent = bg;
    saveNow({ backgroundColor: tc, textColor: bg });
  });

  /* Custom CSS */
  $('customCSS').addEventListener('input', e => {
    saveDebounced({ customCSS: e.target.value });
  });

  /* Add library */
  $('add-lib-btn').addEventListener('click', () => {
    $('add-lib-form').classList.remove('hidden');
    $('add-lib-btn').classList.add('hidden');
    $('new-lib-name').focus();
  });

  $('cancel-add').addEventListener('click', () => {
    $('add-lib-form').classList.add('hidden');
    $('add-lib-btn').classList.remove('hidden');
    $('new-lib-name').value = '';
    $('new-lib-url').value = '';
  });

  $('confirm-add').addEventListener('click', () => {
    const name = $('new-lib-name').value.trim();
    const url  = $('new-lib-url').value.trim();
    if (!name || !url) return;

    const id = 'custom-' + Date.now();
    const lib = { id, name, url, enabled: false, builtin: false, description: url };
    state.cssLibraries = [...state.cssLibraries, lib];
    const newLibraries = state.cssLibraries.map(l => ({ ...l, enabled: l.id === id }));
    saveNow({ cssLibraries: newLibraries });
    renderLibraries();
    updateChaosSettingsVisibility();

    $('add-lib-form').classList.add('hidden');
    $('add-lib-btn').classList.remove('hidden');
    $('new-lib-name').value = '';
    $('new-lib-url').value = '';
  });

  /* Chaos settings */
  $('chaosIntensity').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('chaosIntensityLabel').textContent = v;
    saveDebounced({ chaosIntensity: v });
  });

  /* Terminal settings */
  $('petTerminalFilterMedia').addEventListener('change', e => {
    saveNow({ petTerminalFilterMedia: e.target.checked });
  });

  $('petTerminalNoGlow').addEventListener('change', e => {
    saveNow({ petTerminalNoGlow: e.target.checked });
  });

  $('lcdFilterMedia').addEventListener('change', e => {
    saveNow({ lcdFilterMedia: e.target.checked });
  });

  const pfToggle2 = $('pageFlipEnabled');
  if (pfToggle2) {
    pfToggle2.addEventListener('change', e => {
      saveNow({ pageFlipEnabled: e.target.checked });
    });
  }

  const tsToggle = $('treeStructureEnabled');
  if (tsToggle) {
    tsToggle.addEventListener('change', e => {
      saveNow({ treeStructureEnabled: e.target.checked });
    });
  }

  const gothicToggle = $('gothicEnabled');
  if (gothicToggle) {
    gothicToggle.addEventListener('change', e => {
      saveNow({ gothicEnabled: e.target.checked });
    });
  }

  /* Reset */
  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset all settings to defaults?')) return;
    state = { ...DEFAULTS };
    siteOnlyActive = false;
    chrome.storage.sync.set(state);
    applyStateToUI();
  });
}

/* ── Init ────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  document.body.classList.add('theme-' + THEME);
  [state, currentSite] = await Promise.all([loadSettings(), loadCurrentSite()]);
  siteOnlyActive = !!(currentSite && state.siteSettings?.[currentSite]);
  applyStateToUI();
  bindEvents();
});
