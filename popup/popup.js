const DEFAULT_LIBRARIES = [
  { id: 'win7-glass', name: 'Win7 Glass', url: '',                                                          enabled: false, builtin: true, description: 'Aero glass, blue chrome, translucent panels' },
  { id: 'system-css', name: 'system.css', url: '',                                                          enabled: false, builtin: true, description: 'Classic Mac OS windows, stripes, square controls' },
  { id: 'xp-css',    name: 'XP.css',     url: '',                                                          enabled: false, builtin: true, description: 'Windows XP Luna blue title bars and beige panels' },
  { id: '98-css',    name: '98.css',     url: 'https://cdn.jsdelivr.net/npm/98.css',                      enabled: false, builtin: true, description: 'Windows 98 UI theme' },
  { id: 'chaos',    name: 'Chaos',      url: '',                                                          enabled: false, builtin: true, description: '残垣断壁 · 荒原乱序' },
  { id: 'pet-terminal', name: 'PET Terminal', url: '',                                                     enabled: false, builtin: true, description: 'Black screen, green phosphor text, ASCII controls' },
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
  chaosIntensity: 50,
  chaosBorderWidth: 2,
  smartDarkContrast: 75,
  dimAmount: 30,
  pauseVideosEnabled: false,
  disabledSites: [],
};

let state = { ...DEFAULTS };
let saveTimer = null;
let currentSite = null;

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
      resolve(result);
    });
  });
}

function saveNow(updates = {}) {
  Object.assign(state, updates);
  chrome.storage.sync.set(state);
}

function saveDebounced(updates = {}) {
  Object.assign(state, updates);
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
  el.textContent = state.pauseVideosEnabled
    ? 'New videos stay paused until you click the video.'
    : '';
}

/* ── Render library list ─────────────────── */

function renderLibraries() {
  const list = document.getElementById('library-list');
  list.innerHTML = '';

  state.cssLibraries.forEach(lib => {
    const item = document.createElement('div');
    item.className = 'lib-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'lib-toggle';
    cb.checked = lib.enabled;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.cssLibraries.forEach(l => { l.enabled = false; });
      }
      lib.enabled = cb.checked;
      saveNow();
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

  $('enabled').checked = state.enabled;
  document.getElementById('body').classList.toggle('disabled', !state.enabled);
  updateSiteStatus();
  $('pauseVideosEnabled').checked = state.pauseVideosEnabled;
  updateVideoPauseStatus();

  document.querySelectorAll('input[name=darkMode]').forEach(r => {
    r.checked = r.value === state.darkMode;
  });

  $('bgEnabled').checked = state.bgEnabled;
  $('backgroundColor').value = state.backgroundColor;
  $('backgroundColor').disabled = !state.bgEnabled;
  $('bgHex').textContent = state.backgroundColor;

  $('textEnabled').checked = state.textEnabled;
  $('textColor').value = state.textColor;
  $('textColor').disabled = !state.textEnabled;
  $('textHex').textContent = state.textColor;

  $('fontFamilyEnabled').checked = state.fontFamilyEnabled;
  $('fontFamily').value = state.fontFamily;
  $('fontFamily').disabled = !state.fontFamilyEnabled;

  $('fontSizeEnabled').checked = state.fontSizeEnabled;
  $('fontSize').value = state.fontSize;
  $('fontSize').disabled = !state.fontSizeEnabled;
  $('fontSizeLabel').textContent = state.fontSize + 'px';

  $('globalRadiusEnabled').checked = state.globalRadiusEnabled;
  $('globalRadius').value = state.globalRadius;
  $('globalRadius').disabled = !state.globalRadiusEnabled;
  $('globalRadiusLabel').textContent = state.globalRadius + 'px';
  $('customCSS').value = state.customCSS;

  $('chaosIntensity').value = state.chaosIntensity;
  $('chaosIntensityLabel').textContent = state.chaosIntensity;
  $('chaosBorderWidth').value = state.chaosBorderWidth;
  $('chaosBorderWidthLabel').textContent = state.chaosBorderWidth + 'px';

  $('smartDarkContrast').value = state.smartDarkContrast;
  $('smartDarkContrastLabel').textContent = state.smartDarkContrast;
  $('dimAmount').value = state.dimAmount;
  $('dimAmountLabel').textContent = state.dimAmount + '%';
  updateDarkModeOpts();

  renderLibraries();
  updateChaosSettingsVisibility();
}

function updateDarkModeOpts() {
  const m = state.darkMode;
  document.getElementById('smartdark-opts').classList.toggle('hidden', m !== 'smartdark');
  document.getElementById('dim-opts').classList.toggle('hidden', m !== 'dim');
}

function updateChaosSettingsVisibility() {
  const chaosActive = (state.cssLibraries || []).some(lib => lib.id === 'chaos' && lib.enabled);
  document.getElementById('chaos-settings').classList.toggle('hidden', !chaosActive);
}

/* ── Bind all events ─────────────────────── */

function bindEvents() {
  const $ = id => document.getElementById(id);

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
      state.darkMode = r.value;
      updateDarkModeOpts();
      saveNow({ darkMode: r.value });
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
    $('backgroundColor').disabled = !e.target.checked;
    saveNow({ bgEnabled: e.target.checked });
  });
  $('backgroundColor').addEventListener('input', e => {
    $('bgHex').textContent = e.target.value;
    saveDebounced({ backgroundColor: e.target.value });
  });

  /* Text color */
  $('textEnabled').addEventListener('change', e => {
    $('textColor').disabled = !e.target.checked;
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
    const lib = { id, name, url, enabled: true, builtin: false, description: url };
    state.cssLibraries = [...state.cssLibraries, lib];
    saveNow();
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
  $('chaosBorderWidth').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('chaosBorderWidthLabel').textContent = v + 'px';
    saveDebounced({ chaosBorderWidth: v });
  });

  /* Reset */
  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset all settings to defaults?')) return;
    state = { ...DEFAULTS };
    chrome.storage.sync.set(state);
    applyStateToUI();
  });
}

/* ── Init ────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  [state, currentSite] = await Promise.all([loadSettings(), loadCurrentSite()]);
  applyStateToUI();
  bindEvents();
});
