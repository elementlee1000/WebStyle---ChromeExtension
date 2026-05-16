const DEFAULT_LIBRARIES = [
  {
    id: '98-css',
    name: 'win98',
    url: 'https://cdn.jsdelivr.net/npm/98.css',
    enabled: false,
    builtin: true,
    description: '相约98'
  },
  
  {
    id: 'pet-terminal',
    name: 'PET Terminal',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Black screen, green phosphor text, ASCII controls'
  },
  
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
    id: 'mac-osx',
    name: 'Mac OS X',
    url: '',
    enabled: false,
    builtin: true,
    description: 'Classic OS X Aqua interface, glossy buttons, pinstripes'
  },
  {
    id: 'woodblock-css',
    name: 'Woodblock Print',
    url: '',
    enabled: false,
    builtin: true,
    description: '仿木刻古籍，水墨晕染与不规则边缘'
  },
  {
    id: 'lcd',
    name: 'LCD',
    url: '',
    enabled: false,
    builtin: true,
    description: 'LCD display: sage green bg, dark brown text'
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
  chaosIntensity: 0,
  chaosBorderWidth: 2,
  smartDarkContrast: 75,
  dimAmount: 30,
  treeStructureEnabled: false,
  gothicEnabled: false,
  petTerminalFilterMedia: true,
  petTerminalNoGlow: false,
  lcdFilterMedia: false,
  pauseVideosEnabled: false,
  disabledSites: [],
  siteSettings: {},
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.sync.set(DEFAULTS);
  }
});
