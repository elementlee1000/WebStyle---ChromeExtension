const DEFAULT_LIBRARIES = [
  {
    id: 'win7-glass',
    name: 'Win7 Glass',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Aero glass, blue chrome, translucent panels'
  },
  {
    id: 'system-css',
    name: 'system.css',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Classic Mac OS windows, stripes, square controls'
  },
  {
    id: 'xp-css',
    name: 'XP.css',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Windows XP Luna blue title bars and beige panels'
  },
  {
    id: '98-css',
    name: '98.css',
    url: 'https://cdn.jsdelivr.net/npm/98.css',
    enabled: false,
    builtin: true,
    description: '相约98'
  },
  {
    id: 'chaos',
    name: 'Chaos',
    url: '',
    enabled: false,
    builtin: true,
    description: '残垣断壁 · 荒原乱序'
  },
  {
    id: 'pet-terminal',
    name: 'PET Terminal',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Black screen, green phosphor text, ASCII controls'
  }
];

const DEFAULTS = {
  enabled: false,
  darkMode: 'off',
  bgEnabled: false,
  backgroundColor: '#bebebe',
  textEnabled: false,
  textColor: '#000000',
  fontFamilyEnabled: false,
  fontFamily: 'system-ui, sans-serif',
  fontSizeEnabled: false,
  fontSize: 16,
  customCSS: '',
  cssLibraries: DEFAULT_LIBRARIES,
  chaosIntensity: 50,
  chaosBorderWidth: 2,
  smartDarkContrast: 75,
  dimAmount: 30,
  pauseVideosEnabled: false,
  disabledSites: [],
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.sync.set(DEFAULTS);
  }
});
