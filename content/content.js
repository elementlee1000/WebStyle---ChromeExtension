(function () {
  const STYLE_ID      = 'style-override-ext';
  const VARS_STYLE_ID = 'style-override-ext-vars';
  const LIB_ATTR      = 'data-style-override-lib';
  const BG_ATTR       = 'data-soe-bg';
  const OVL_ATTR      = 'data-soe-transparent';
  const DIM_ATTR      = 'data-soe-dim';
  const FLIP_WRAP_ID      = 'soe-flip-wrap';
  const FLIP_NAV_ID       = 'soe-flip-nav';
  const FLIP_STYLE_ID     = 'soe-flip-style';
  const FLIP_REFORMAT_ID  = 'soe-flip-reformat';
  const EARLY_BG_ID        = 'soe-early-bg';
  const SHADOW_DARK_ID     = 'soe-shadow-dark';
  const SETTINGS_CACHE_KEY = 'soe_settings_cache';

  /* ── 零延迟背景预热：从 localStorage 同步读取上次配置，立即遮住白屏 ── */
  (function injectEarlyBg() {
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (!raw) return;
      const cache = JSON.parse(raw);
      if (!cache.enabled) return;
      const hostname = location.hostname.replace(/^www\./, '').toLowerCase();
      if ((cache.disabledSites || []).some(s => {
        const d = (s || '').replace(/^www\./, '').toLowerCase();
        return hostname === d || hostname.endsWith('.' + d);
      })) return;
      let bg = null;
      if (cache.darkMode === 'smartdark') bg = '#1a1a1a';
      else if (cache.darkMode === 'lightmode') bg = cache.bgEnabled && cache.backgroundColor ? cache.backgroundColor : '#c0c0c0';
      else if (cache.bgEnabled && cache.backgroundColor) bg = cache.backgroundColor;
      if (!bg) return;
      const style = document.createElement('style');
      style.id = EARLY_BG_ID;
      style.textContent = `html,body{background-color:${bg}!important}`;
      document.documentElement.appendChild(style);
    } catch(e) {}
  })();

  let bgObserver = null;
  let bgMutTimer = null;
  let cssVarTimer = null;
  let dimObserver = null;
  let videoPauseObserver = null;
  let videoPauseEnabled = false;
  let nativeDarkDetected = false;
  let hasCheckedNativeDark = false;
  let lastAppliedDarkMode = null;
  let bgProcessId = 0;
  const shadowDarkRoots = new Set();
  const managedVideos = new WeakSet();
  const userAllowedVideos = new WeakSet();
  let pageFlipActive = false;
  let pageFlipCurrent = 0;
  let pageFlipTotal = 0;
  let pageFlipPages = [];
  let pageFlipObserver = null;
  let pageFlipKeyHandler = null;
  let pageFlipWasEnabled = false;

  /* ── 辅助函数：安全且极速地挂载样式 ── */
  function injectToRoot(element) {
    const target = document.documentElement || document.head;
    if (target) {
      target.appendChild(element);
    } else {
      // 极端情况：DOM 还没准备好，等待 body/documentElement 可用
      const observer = new MutationObserver(() => {
        const t = document.documentElement || document.head;
        if (t) {
          t.appendChild(element);
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    }
  }

  /* ── Cleanup ──────────────────────────────── */
  function removeInjected() {
    [STYLE_ID, VARS_STYLE_ID, EARLY_BG_ID].forEach(id => document.getElementById(id)?.remove());
    document.querySelectorAll(`[${LIB_ATTR}]`).forEach(e => e.remove());
    clearBgJS();
    clearDimJS();
  }

  function normalizeSiteHost(hostname) {
    return (hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isSiteDisabled(settings) {
    const hostsToCheck = new Set([normalizeSiteHost(location.hostname)]);
    
    // 1. 尝试获取常规情况下的顶层窗口域名
    try {
      if (window.top && window.top.location && window.top.location.hostname) {
        hostsToCheck.add(normalizeSiteHost(window.top.location.hostname));
      }
    } catch(e) {}
    
    // 2. 核心修复：穿透跨域沙盒 (Iframe)，获取顶级父页面域名 (针对 AI Studio 等应用)
    if (location.ancestorOrigins && location.ancestorOrigins.length > 0) {
      try {
        const topOrigin = location.ancestorOrigins[location.ancestorOrigins.length - 1];
        hostsToCheck.add(normalizeSiteHost(new URL(topOrigin).hostname));
      } catch(e) {}
    }

    return (settings.disabledSites || []).some(site => {
      const disabled = normalizeSiteHost(site);
      for (const host of hostsToCheck) {
        if (host === disabled || host.endsWith('.' + disabled)) return true;
      }
      return false;
    });
  }

  /* ── CSS Builder ─────────────────────────── */
  const MEDIA_SELECTOR = 'img, video, iframe, canvas, embed, object, picture, svg';
  const MEDIA_PLAYER_SELECTOR = [
    '#movie_player',
    '.html5-video-player',
    '.html5-video-container',
    '.ytp-player-content',
    '.ytp-chrome-top',
    '.ytp-chrome-bottom',
    '.ytp-gradient-top',
    '.ytp-gradient-bottom',
    'ytd-player',
    '#player-container',
    '#player'
  ].join(', ');
  const INLINE_TEXT_TAGS = new Set([
    'A','ABBR','B','BDI','BDO','CITE','CODE','DATA','DFN','EM','I','KBD','MARK','Q',
    'RP','RT','RUBY','S','SAMP','SMALL','SPAN','STRONG','SUB','SUP','TIME','U','VAR'
  ]);

  function bgRule(color) {
    return `html, body { background-color: ${color} !important; }\n` +
           `[${OVL_ATTR}] { background-color: transparent !important; }\n`;
  }

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2;
    if (max === min) return { h:0, s:0, l };
    const d = max-min, s = d/(1-Math.abs(2*l-1));
    let h;
    if (max===r) h = ((g-b)/d%6+6)%6;
    else if (max===g) h = (b-r)/d+2;
    else h = (r-g)/d+4;
    return { h: h*60, s, l };
  }

  function hslToHex(h, s, l) {
    const a = s*Math.min(l,1-l);
    const f = n => { const k=(n+h/30)%12, c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,'0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function buildCSS(s) {
    let css = '';

    if (s.darkMode === 'smartdark') {
      const contrast = Math.min(100, Math.max(0, s.smartDarkContrast ?? 75));
      const textV = Math.round(150 + (contrast / 100) * 105);
      const mutedV = Math.round(105 + (contrast / 100) * 95);
      const borderV = Math.round(55 + (contrast / 100) * 65);
      const linkG = Math.round(145 + (contrast / 100) * 70);
      const textCol = `rgb(${textV},${Math.max(0, textV - 4)},${Math.max(0, textV - 8)})`;
      const mutedCol = `rgb(${mutedV},${mutedV},${mutedV})`;
      const borderCol = `rgb(${borderV},${borderV},${borderV})`;
      const linkCol = `rgb(105,${linkG},255)`;
      css += `
/* ── Smart Dark ── */
:root { color-scheme: dark; }
/* Strip bright page surfaces while preserving media. */
*:not(img):not(video):not(iframe):not(canvas):not(embed):not(object):not(picture):not(svg):not(svg *) {
  background-color: transparent !important;
  border-color: ${borderCol} !important;
}
html, body { background-color: #1a1a1a !important; color: ${textCol} !important; }
/* Override site-authored dark text. Contrast slider feeds these colors. */
:where(body, body *):not(img):not(video):not(iframe):not(canvas):not(embed):not(object):not(picture):not(svg):not(svg *) {
  color: ${textCol} !important;
  caret-color: ${textCol} !important;
}
:where(p, li, span, label, small, caption, figcaption, dt, dd, blockquote, cite,
summary, details, address, time, strong, em, b, i, u, mark,
h1, h2, h3, h4, h5, h6,
td, th, div, section, article, aside, main, header, footer, nav,
button, input, textarea, select, option, [role], [class], [id])::before,
:where(p, li, span, label, small, caption, figcaption, dt, dd, blockquote, cite,
summary, details, address, time, strong, em, b, i, u, mark,
h1, h2, h3, h4, h5, h6,
td, th, div, section, article, aside, main, header, footer, nav,
button, input, textarea, select, option, [role], [class], [id])::after {
  color: ${textCol} !important;
}
img, picture { background-color: #888888 !important; }
::placeholder { color: ${mutedCol} !important; opacity: 1 !important; }
header, footer, nav { background-color: #1e1e1e !important; }
article, section, aside, main,
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="dialog"]:not(input):not(button),
[class*="drawer"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button),
[class*="menu"]:not(input):not(button),
[class*="popup"]:not(input):not(button),
[class*="tooltip"]:not(input):not(button),
[class*="overlay"]:not(input):not(button) { background-color: #242424 !important; }
#movie_player,
#movie_player *,
.html5-video-player,
.html5-video-player *,
ytd-player,
ytd-player *,
#player-container,
#player-container * {
  background-color: transparent !important;
}
input, textarea, select { background-color: #2d2d2d !important; color: ${textCol} !important; }
button { background-color: #2a2a2a !important; color: ${textCol} !important; }
pre, code, kbd { background-color: #252525 !important; color: #f0ebe1 !important; }
a, a :where(span, b, strong, i, em, u, mark, sup, sub) { color: ${linkCol} !important; }
a:visited, a:visited :where(span, b, strong, i, em, u, mark, sup, sub) { color: #c7a7ff !important; }
/* 免除内部包含结构性元素的链接变紫/变蓝 */
a :is(svg, svg *, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd, [class*="icon" i]),
a:visited :is(svg, svg *, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd, [class*="icon" i]) { color: ${textCol} !important; }
/* 免除本身是 UI 按钮/图标的链接，以及侧边栏、导航栏中的结构性链接 */
:is(nav, aside, header, footer, menu, [role="navigation"], [role="banner"], [role="menu"], [role="tablist"], [class*="nav" i]:not(a), [class*="menu" i]:not(a), [class*="sidebar" i]) a,
:is(nav, aside, header, footer, menu, [role="navigation"], [role="banner"], [role="menu"], [role="tablist"], [class*="nav" i]:not(a), [class*="menu" i]:not(a), [class*="sidebar" i]) a:visited,
:is(nav, aside, header, footer, menu, [role="navigation"], [role="banner"], [role="menu"], [role="tablist"], [class*="nav" i]:not(a), [class*="menu" i]:not(a), [class*="sidebar" i]) a *,
:is(nav, aside, header, footer, menu, [role="navigation"], [role="banner"], [role="menu"], [role="tablist"], [class*="nav" i]:not(a), [class*="menu" i]:not(a), [class*="sidebar" i]) a:visited *,
a:is([role="button"], [role="menuitem"], [role="tab"], [class*="btn" i], [class*="button" i], [class*="icon" i]),
a:visited:is([role="button"], [role="menuitem"], [role="tab"], [class*="btn" i], [class*="button" i], [class*="icon" i]),
a:is([role="button"], [role="menuitem"], [role="tab"], [class*="btn" i], [class*="button" i], [class*="icon" i]) *,
a:visited:is([role="button"], [role="menuitem"], [role="tab"], [class*="btn" i], [class*="button" i], [class*="icon" i]) * { color: ${textCol} !important; }
/* 强制恢复真正的纯文本超链接的蓝紫色（高优先级覆盖导航栏的一刀切） */
a:not([role="button"]):not([role="menuitem"]):not([role="tab"]):not([class*="btn" i]):not([class*="button" i]):not([class*="icon" i]):not(:has(svg, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd)),
a:not([role="button"]):not([role="menuitem"]):not([role="tab"]):not([class*="btn" i]):not([class*="button" i]):not([class*="icon" i]):not(:has(svg, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd)) :where(span, b, strong, i, em, u, mark, sup, sub) { color: ${linkCol} !important; }
a:visited:not([role="button"]):not([role="menuitem"]):not([role="tab"]):not([class*="btn" i]):not([class*="button" i]):not([class*="icon" i]):not(:has(svg, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd)),
a:visited:not([role="button"]):not([role="menuitem"]):not([role="tab"]):not([class*="btn" i]):not([class*="button" i]):not([class*="icon" i]):not(:has(svg, div, p, article, section, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, ul, li, dl, dt, dd)) :where(span, b, strong, i, em, u, mark, sup, sub) { color: #c7a7ff !important; }
small, .muted, [class*="muted"], [class*="secondary"], [class*="meta"],
[class*="subtle"], [aria-disabled="true"], [disabled] { color: ${mutedCol} !important; }
th { background-color: #252525 !important; }
::-webkit-scrollbar { background-color: #1a1a1a; }
::-webkit-scrollbar-thumb { background-color: #444; }
`;
      // Google Docs / Slides：高优先级还原编辑区域，工具栏/菜单仍受干预
      if (location.hostname === 'docs.google.com') {
        if (location.pathname.startsWith('/document/')) {
          css += `/* ── Google Docs: 保留文档编辑区域 ── */
html body #kix-appview{background-color:#f8f9fa!important;color:#202124!important}
html body .kix-page,html body .kix-page-content-wrapper,html body .kix-page-canvas-clip{background-color:#ffffff!important}
html body #kix-appview *:not(img):not(video):not(canvas):not(svg):not(svg *){color:inherit!important;border-color:inherit!important;caret-color:inherit!important}
html body #kix-appview a,html body #kix-appview a *{color:#1155cc!important}
html body #kix-appview a:visited,html body #kix-appview a:visited *{color:#7722bb!important}
`;
        } else if (location.pathname.startsWith('/presentation/')) {
          css += `/* ── Google Slides: 保留幻灯片编辑区域 ── */
html body .punch-viewer-content,html body #punch-slide-views{background-color:#f1f3f4!important;color:#202124!important}
html body .punch-viewer-content *:not(img):not(video):not(canvas):not(svg):not(svg *){color:inherit!important;border-color:inherit!important}
`;
        }
      }
    }

    if (s.darkMode === 'dim') {
      const pct = Math.min(90, Math.max(0, s.dimAmount ?? 30));
      const br    = (1 - pct / 100).toFixed(6);
      const brInv = (1 / (1 - pct / 100)).toFixed(6);
      const _host = location.hostname;
      // IG/Google Images：图片类随 body 暗化，只补偿非图片媒体
      const _skipImgInv = _host.includes('instagram.com') ||
                          (_host.includes('google.com') && /[?&]tbm=isch/.test(location.search));
      // CSS 只能覆盖 inline style 的 background-image；computed style 由 JS 兜底
      const _invSel = _skipImgInv
        ? 'video, canvas, iframe, embed, object'
        : `${MEDIA_SELECTOR}, [style*="background-image"]`;
      css += `
/* ── Dim ── */
body { filter: brightness(${br}) !important; }
${_invSel} { filter: brightness(${brInv}) !important; }
`;
      if (_googleEditSel) {
        css += `/* ── Google Docs/Slides: 编辑区域不暗化 ── */
${_googleEditSel} { filter: brightness(${brInv}) !important; }
${_googleEditSel} ${MEDIA_SELECTOR} { filter: none !important; }
`;
      }
    }

    if (s.darkMode === 'lightmode') {
      const bg = (s.bgEnabled && s.backgroundColor) ? s.backgroundColor : '#bebebe';
      const fg = (s.textEnabled && s.textColor) ? s.textColor : '#000000';
      css += `
/* ── Light Mode ── */
html, body { background-color: ${bg} !important; color: ${fg} !important; }
body, body * { color: ${fg} !important; }
`;
    }

    if (s.textEnabled && s.textColor) css += `body, body * { color: ${s.textColor} !important; }\n`;
    if (s.fontFamilyEnabled && s.fontFamily) css += `html, body, body * { font-family: ${s.fontFamily} !important; }\n`;
    if (s.fontSizeEnabled && s.fontSize) css += `html { font-size: ${s.fontSize}px !important; }\n`;
    if (s.customCSS) css += s.customCSS + '\n';

    /* ── 特效板块：Chaos Intensity (随机散落偏移) ── */
    const chaosT = Math.min(1, Math.max(0, (s.chaosIntensity ?? 0) / 100));
    if (chaosT > 0) {
      const rPm  = () => Math.round((Math.random() * 2 - 1) * 24 * chaosT);
      const rPos = () => Math.round(Math.random() * 30 * chaosT);
      const rWid = () => Math.round(100 - Math.random() * 30 * chaosT);
      const rMar = () => Math.round((Math.random() * 32 - 12) * chaosT);
      const posA  = Array.from({length: 5}, () => [rPm(), rPm()]);
      const widB  = Array.from({length: 7}, () => rWid());
      const padC  = Array.from({length: 3}, () => [rPos(), rPos(), rPos(), rPos()]);
      const marD  = Array.from({length: 4}, () => rMar());
      const txtML = Array.from({length: 5}, () => rPos());
      const liPL  = Array.from({length: 4}, () => rPos());
      const hML   = Array.from({length: 3}, () => rPos());

      css += `
/* ── Global scatter offsets ── */
div:nth-child(5n+1){position:relative !important;top:${posA[0][0]}px !important;left:${posA[0][1]}px !important}
div:nth-child(5n+2){position:relative !important;top:${posA[1][0]}px !important;left:${posA[1][1]}px !important}
div:nth-child(5n+3){position:relative !important;top:${posA[2][0]}px !important;left:${posA[2][1]}px !important}
div:nth-child(5n+4){position:relative !important;top:${posA[3][0]}px !important;left:${posA[3][1]}px !important}
div:nth-child(5n+0){position:relative !important;top:${posA[4][0]}px !important;left:${posA[4][1]}px !important}
div:nth-child(7n+1){max-width:${widB[0]}% !important}div:nth-child(7n+2){max-width:${widB[1]}% !important}
div:nth-child(7n+3){max-width:${widB[2]}% !important}div:nth-child(7n+4){max-width:${widB[3]}% !important}
div:nth-child(7n+5){max-width:${widB[4]}% !important}div:nth-child(7n+6){max-width:${widB[5]}% !important}
div:nth-child(7n+0){max-width:${widB[6]}% !important}
div:nth-child(3n+1){padding:${padC[0][0]}px ${padC[0][1]}px ${padC[0][2]}px ${padC[0][3]}px !important}
div:nth-child(3n+2){padding:${padC[1][0]}px ${padC[1][1]}px ${padC[1][2]}px ${padC[1][3]}px !important}
div:nth-child(3n+0){padding:${padC[2][0]}px ${padC[2][1]}px ${padC[2][2]}px ${padC[2][3]}px !important}
div:nth-child(4n+1){margin-top:${marD[0]}px !important;z-index:2 !important}
div:nth-child(4n+2){margin-top:${marD[1]}px !important}
div:nth-child(4n+3){margin-top:${marD[2]}px !important;z-index:3 !important}
div:nth-child(4n+0){margin-top:${marD[3]}px !important}
p:nth-of-type(5n+1){margin-left:${txtML[0]}px !important}p:nth-of-type(5n+2){margin-left:${txtML[1]}px !important}
p:nth-of-type(5n+3){margin-left:${txtML[2]}px !important}p:nth-of-type(5n+4){margin-left:${txtML[3]}px !important}
p:nth-of-type(5n+0){margin-left:${txtML[4]}px !important}
li:nth-child(4n+1){padding-left:${liPL[0]}px !important}li:nth-child(4n+2){padding-left:${liPL[1]}px !important}
li:nth-child(4n+3){padding-left:${liPL[2]}px !important}li:nth-child(4n+0){padding-left:${liPL[3]}px !important}
h2{margin-left:${hML[0]}px !important}h3{margin-left:${hML[1]}px !important}h4{margin-left:${hML[2]}px !important}
`;
    }

    /* ── 特效板块：Tree Structure (网页降维 ASCII 树图) ── */
    if (s.treeStructureEnabled) {
      css += `
/* ════ COMPACT MATRIX CLUSTER TREE MAP ════ */
html, body {
  background-color: #bebebe !important;
  color: #111111 !important;
  font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace !important;
  font-size: 13px !important; /* 减小字号，让排版更紧凑 */
  line-height: 1.5 !important;
  margin: 0 !important;
  padding: 8px 12px !important; /* 缩小全局内边距 */
}

/* Force hide data scripts and invisible system tags */
html body script, html body style, html body meta, html body link, html body noscript, html body template, html body iframe,
html body [hidden], html body [style*="display: none"], html body [style*="display:none"], html body [style*="display:none;"] {
  display: none !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Strip ALL modern UI */
*, *::before, *::after {
  box-sizing: border-box !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border: none !important;
  border-radius: 0 !important;
  text-shadow: none !important;
  transition: none !important;
  transform: none !important;
  float: none !important;
  position: static !important;
  overflow: visible !important; /* 强制显示所有被原网页隐藏的溢出内容 */
  height: auto !important; /* 解除高度封印，自动向下撑开 */
  max-height: none !important;
  min-height: 0 !important;
  width: auto !important; /* 解除宽度封印，由 Flexbox 接管排版 */
  max-width: none !important;
}

/* 自动隐藏毫无内容的空壳节点，防止产生无意义的空白嵌套 */
div:empty, span:empty, p:empty {
  display: none !important;
}

/* 1. Structural Containers (Compact Tree depth + Matrix) */
div, section, article, aside, main, header, footer, nav, ul, ol, form, fieldset, table, tbody, tr, blockquote, figure {
  display: flex !important;
  flex-wrap: wrap !important; /* 开启矩阵弹性折行 */
  align-items: flex-start !important; /* 核心：取消纵向强制拉伸 */
  align-content: flex-start !important;
  gap: 4px !important; /* 极小化矩阵方块间距 */
  margin: 1px 0 1px 8px !important; /* 极限压缩垂直边距，防止 div 嵌套地狱产生大片空白 */
  padding: 0 0 0 6px !important; /* 取消上下内边距，仅保留左侧内边距让开引导线 */
  border-left: 1px solid #888888 !important; /* 更细的树干引导线 */
  background-color: transparent !important; /* 彻底去除容器背景 */
  width: 100% !important; /* 强制占据整行，将下一级推向更深处 */
  max-width: 100% !important;
  min-width: 0 !important; /* 核心：防止 Flex 子项溢出撑爆屏幕 */
  flex: 1 1 100% !important;
  color: inherit !important;
}

/* 2. Content Nodes (Adaptive Matrix Tiles) */
p, h1, h2, h3, h4, h5, h6, li, dt, dd, figcaption, td, th {
  display: block !important;
  flex: 0 1 auto !important; /* 核心：取消横向强制拉伸，元素文本有多长就占多宽 */
  margin: 0 !important;
  padding: 4px 8px !important; /* 减小内容块内边距 */
  white-space: normal !important;
  max-width: 65ch !important; /* 核心：限制最大宽度为约 65 字符，强制适当换行，防止横向过长 */
  overflow-wrap: break-word !important;
  text-align: left !important;
  color: #111111 !important;
  background-color: transparent !important; /* 彻底去除节点背景 */
  border: 1px dotted #888888 !important;
}

/* ASCII tree prefixes for content nodes */
p::before, h1::before, h2::before, h3::before, h4::before, h5::before, h6::before, li::before, dt::before, dd::before, figcaption::before, td::before, th::before {
  content: "├─ " !important;
  color: #555555 !important;
  white-space: pre !important;
}
p:last-child::before, h1:last-child::before, h2:last-child::before, h3:last-child::before, h4:last-child::before, h5:last-child::before, h6:last-child::before, li:last-child::before, dt:last-child::before, dd:last-child::before, figcaption:last-child::before, td:last-child::before, th:last-child::before {
  content: "└─ " !important;
}

/* Headers */
h1, h2, h3 { font-weight: bold !important; color: #4a148c !important; }
h1 { font-size: 1.4em !important; }
h2 { font-size: 1.2em !important; }
h3 { font-size: 1.1em !important; }

/* Form Controls */
button, input, select, textarea { 
  display: inline-block !important;
  flex: 0 1 auto !important; /* 表单件不强制拉伸 */
  margin: 0 !important;
  padding: 0 4px !important; /* 减小表单边距 */
  vertical-align: middle !important;
  color: #006600 !important; 
  border-bottom: 1px dashed #888888 !important; 
}
button::before, input[type="button"]::before, input[type="submit"]::before { content: "[" !important; color: #555555 !important; }
button::after, input[type="button"]::after, input[type="submit"]::after { content: "]" !important; color: #555555 !important; }

/* 3. Pure Inline Tags */
span, a, b, i, strong, em, small, code, kbd, samp, q, mark, abbr, label, time {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  white-space: normal !important;
}
a, a:visited { color: #0000ee !important; text-decoration: underline !important; text-decoration-style: dashed !important; }

/* 4. Media Elements (Matrix fixed size 64x64) */
img, video, canvas, picture, svg {
  display: inline-block !important;
  flex: 0 0 auto !important;
  width: 64px !important;
  height: 64px !important;
  max-width: 64px !important;
  max-height: 64px !important;
  width: auto !important;
  height: auto !important;
  vertical-align: middle !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 1px dotted #888888 !important;
  object-fit: cover !important;
}
svg { max-width: 32px !important; max-height: 32px !important; border: none !important; }
svg * { display: inline !important; fill: currentColor !important; stroke: currentColor !important; margin: 0 !important; padding: 0 !important; }

/* 5. Highlight Hover */
body *:hover {
  background-color: transparent !important; /* 去除悬停时的背景色块 */
  outline: 1px dotted #888888 !important;
  outline-offset: -1px !important;
}
`;
    }

    if (s.globalRadiusEnabled && typeof s.globalRadius === 'number') {
      const r = Math.max(0, s.globalRadius);
      css += `* , *::before, *::after { border-radius: ${r}px !important; }\n`;
    }

    if ((s.cssLibraries || []).some(l => l.enabled && l.id === 'pet-terminal')) {
      let fg = '#5cff5c', bg = '#000000', bgCode = '#002000', fgLight = '#9cff9c';
      let glowA = 'rgba(92,255,92,.65)', glowB = 'rgba(92,255,92,.55)', scan = 'rgba(92,255,92,.08)';
      let imgFilter = 'sepia(1) hue-rotate(55deg) saturate(1.2) contrast(0.85) brightness(0.85)';

      if (s.textEnabled && s.textColor && /^#[0-9a-fA-F]{6}$/.test(s.textColor)) {
        const { h, s: sat, l: lit } = hexToHsl(s.textColor);
        fg = s.textColor;
        bg      = hslToHex(h, sat, 0.04);
        bgCode  = hslToHex(h, sat, 0.08);
        fgLight = hslToHex(h, sat, Math.min(0.9, lit + 0.22));
        const rv = parseInt(s.textColor.slice(1,3),16);
        const gv = parseInt(s.textColor.slice(3,5),16);
        const bv = parseInt(s.textColor.slice(5,7),16);
        glowA = `rgba(${rv},${gv},${bv},.65)`;
        glowB = `rgba(${rv},${gv},${bv},.55)`;
        scan  = `rgba(${rv},${gv},${bv},.08)`;
        const hRot = Math.round(((h - 65) + 360) % 360);
        imgFilter = `sepia(1) hue-rotate(${hRot}deg) saturate(1.2) contrast(0.85) brightness(0.85)`;
      }

      const mediaLine = s.petTerminalFilterMedia !== false
        ? `  filter: ${imgFilter} !important;\n  border: 1px dashed ${fg} !important;`
        : `  border: 1px dashed ${fg} !important;`;
        
      const textShadowA = s.petTerminalNoGlow ? 'none !important' : `0 0 4px ${glowA} !important`;
      const textShadowB = s.petTerminalNoGlow ? 'none !important' : `0 0 4px ${glowB} !important`;

      css += `
/* ════ PET TERMINAL ════ */
html, body {
  background: ${bg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
  text-shadow: ${textShadowA};
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  background: repeating-linear-gradient(0deg,${scan} 0 1px,transparent 1px 4px) !important;
  mix-blend-mode: screen;
}
*,*::before,*::after {
  color: ${fg} !important;
  border-color: ${fg} !important;
  box-shadow: none !important;
  text-shadow: ${textShadowB};
  border-radius: 0 !important;
}
html,body,
article,section,aside,main,nav,header,footer,
[role="dialog"],[role="menu"],[role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) { background: ${bg} !important; }
article,section,aside,main,nav,header,footer,
[role="dialog"],[role="menu"],[role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button),
table,th,td,fieldset { border-style: dashed !important; border-width: 1px !important; }
hr,[role="separator"] { border:0 !important; border-top:1px dashed ${fg} !important; background:transparent !important; }
a, a:visited { color: ${fgLight} !important; text-decoration:underline !important; text-decoration-style:dashed !important; }
button,input[type="button"],input[type="submit"],input[type="reset"],
[role="button"]:not(:has(button,[role="button"])) {
  background: ${bg} !important;
  border: 1px dashed ${fg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
  text-transform: uppercase !important;
}
button::before,input[type="button"]::before,input[type="submit"]::before,
input[type="reset"]::before,[role="button"]:not(:has(button,[role="button"]))::before { content:"[ " !important; }
button::after,input[type="button"]::after,input[type="submit"]::after,
input[type="reset"]::after,[role="button"]:not(:has(button,[role="button"]))::after  { content:" ]" !important; }
button:hover,[role="button"]:hover { background:${fg} !important; color:${bg} !important; text-shadow:none !important; }
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"]),
textarea,select {
  background: ${bg} !important;
  border: 1px dashed ${fg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
}
input[type="checkbox"],input[type="radio"] {
  appearance:none !important; -webkit-appearance:none !important;
  width:3ch !important; height:1.3em !important;
  border:0 !important; background:transparent !important;
  display:inline-grid !important; place-items:center !important; vertical-align:middle !important;
}
input[type="checkbox"]::before,input[type="radio"]::before { content:"[ ]" !important; color:${fg} !important; }
input[type="checkbox"]:checked::before,input[type="radio"]:checked::before { content:"[X]" !important; }
input[type="range"] { appearance:none !important; -webkit-appearance:none !important; background:transparent !important; border:0 !important; }
input[type="range"]::-webkit-slider-runnable-track {
  height:1em !important;
  border-top:1px dashed ${fg} !important;
  background:repeating-linear-gradient(90deg,${fg} 0 1px,transparent 1px 1ch) !important;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance:none !important;
  width:1ch !important; height:1.4em !important; margin-top:-.2em !important;
  background:${fg} !important; border:0 !important;
}
input[type="range"]::-moz-range-track { height:1em !important; border-top:1px dashed ${fg} !important; background:transparent !important; }
input[type="range"]::-moz-range-thumb { width:1ch !important; height:1.4em !important; background:${fg} !important; border:0 !important; }
pre,code,kbd,samp { background:${bgCode} !important; border:1px dashed ${fg} !important; color:${fgLight} !important; }
img, video, canvas, picture, svg, [style*="background-image"] {
${mediaLine}
}
::selection { background:${fg} !important; color:${bg} !important; }
`;
    }

    if ((s.cssLibraries || []).some(l => l.enabled && l.id === 'lcd')) {
      const bg = (s.bgEnabled && s.backgroundColor) ? s.backgroundColor : '#c1c8b1';
      const fg = '#342d18', bgCode = '#adb5a1', fgLight = '#5a5030';
      const mediaCss = s.lcdFilterMedia
        ? `img, video, canvas, picture, svg, [style*="background-image"] {
  filter: grayscale(1) !important;
  mix-blend-mode: multiply !important;
  border: 1px dashed ${fg} !important;
}
:has(> img), :has(> video), :has(> canvas), :has(> picture) {
  background-color: ${bg} !important;
}`
        : `img, video, canvas, picture, svg, [style*="background-image"] {
  border: 1px dashed ${fg} !important;
}`;

      css += `
/* ════ LCD ════ */
html, body {
  background: ${bg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
}
*,*::before,*::after {
  color: ${fg} !important;
  border-color: ${fg} !important;
  box-shadow: none !important;
  text-shadow: none !important;
  border-radius: 0 !important;
}
html,body,
article,section,aside,main,nav,header,footer,
[role="dialog"],[role="menu"],[role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) { background: ${bg} !important; }
article,section,aside,main,nav,header,footer,
[role="dialog"],[role="menu"],[role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button),
table,th,td,fieldset { border-style: dashed !important; border-width: 1px !important; }
hr,[role="separator"] { border:0 !important; border-top:1px dashed ${fg} !important; background:transparent !important; }
a, a:visited { color: ${fgLight} !important; text-decoration:underline !important; text-decoration-style:dashed !important; }
button,input[type="button"],input[type="submit"],input[type="reset"],
[role="button"]:not(:has(button,[role="button"])) {
  background: ${bg} !important;
  border: 1px dashed ${fg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
  text-transform: uppercase !important;
}
button::before,input[type="button"]::before,input[type="submit"]::before,
input[type="reset"]::before,[role="button"]:not(:has(button,[role="button"]))::before { content:"[ " !important; }
button::after,input[type="button"]::after,input[type="submit"]::after,
input[type="reset"]::after,[role="button"]:not(:has(button,[role="button"]))::after  { content:" ]" !important; }
button:hover,[role="button"]:hover { background:${fg} !important; color:${bg} !important; }
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"]),
textarea,select {
  background: ${bg} !important;
  border: 1px dashed ${fg} !important;
  color: ${fg} !important;
  font-family: "Courier New","Lucida Console",Consolas,monospace !important;
}
input[type="checkbox"],input[type="radio"] {
  appearance:none !important; -webkit-appearance:none !important;
  width:3ch !important; height:1.3em !important;
  border:0 !important; background:transparent !important;
  display:inline-grid !important; place-items:center !important; vertical-align:middle !important;
}
input[type="checkbox"]::before,input[type="radio"]::before { content:"[ ]" !important; color:${fg} !important; }
input[type="checkbox"]:checked::before,input[type="radio"]:checked::before { content:"[X]" !important; }
input[type="range"] { appearance:none !important; -webkit-appearance:none !important; background:transparent !important; border:0 !important; }
input[type="range"]::-webkit-slider-runnable-track {
  height:1em !important;
  border-top:1px dashed ${fg} !important;
  background:repeating-linear-gradient(90deg,${fg} 0 1px,transparent 1px 1ch) !important;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance:none !important;
  width:1ch !important; height:1.4em !important; margin-top:-.2em !important;
  background:${fg} !important; border:0 !important;
}
input[type="range"]::-moz-range-track { height:1em !important; border-top:1px dashed ${fg} !important; background:transparent !important; }
input[type="range"]::-moz-range-thumb { width:1ch !important; height:1.4em !important; background:${fg} !important; border:0 !important; }
pre,code,kbd,samp { background:${bgCode} !important; border:1px dashed ${fg} !important; color:${fgLight} !important; }
${mediaCss}
::selection { background:${fg} !important; color:${bg} !important; }
`;
    }

    return css;
  }

  /* ── 优化后的 CSS 变量提取：增加防抖与同源过滤 ── */
  const BG_VAR_RE = /bg|background|surface|fill|wash|canvas|base|raised|sheet|backdrop|panel|container|wrap/i;

  function isColorValue(val) {
    const v = val.trim();
    return /^#[0-9a-f]{3,8}$/i.test(v) || v.startsWith('rgb') || v.startsWith('hsl') || ['white', 'black', 'transparent'].includes(v.toLowerCase());
  }

  function injectCssVarOverrides(color) {
    clearTimeout(cssVarTimer);
    cssVarTimer = setTimeout(() => {
      document.getElementById(VARS_STYLE_ID)?.remove();
      const varNames = new Set();
      try {
        for (const sheet of document.styleSheets) {
          // 关键优化：跳过 CORS 限制的跨域样式表，防止 SecurityError
          try { if (sheet.href && new URL(sheet.href).origin !== location.origin) continue; } catch { continue; }
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          if (!rules) continue;

          for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            const style = rule.style;
            for (let i = 0; i < style.length; i++) {
              const prop = style[i];
              if (!prop.startsWith('--') || !BG_VAR_RE.test(prop)) continue;
              if (isColorValue(style.getPropertyValue(prop))) varNames.add(prop);
            }
          }
        }
      } catch {}

      if (!varNames.size) return;
      const style = document.createElement('style');
      style.id = VARS_STYLE_ID;
      style.textContent = `:root {\n${Array.from(varNames).map(v => `  ${v}: ${color} !important;`).join('\n')}\n}`;
      injectToRoot(style);
    }, 150); // 150ms 的防抖，避免重复扫描
  }

  /* ── 优化后的 Shadow DOM 深度处理 ── */
  function* walkAllElements(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      yield node;
      if (node.shadowRoot) yield* walkAllElements(node.shadowRoot);
    }
  }

  function findVideoNearClick(event) {
    // Try composedPath first (direct click on <video>)
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const direct = path.find(n => n instanceof HTMLVideoElement);
    if (direct) return direct;
    // Most players use an overlay div; fall back to bounding-rect hit test
    const { clientX: x, clientY: y } = event;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  function allowVideoFromUser(event) {
    const video = findVideoNearClick(event);
    if (!video) return;
    userAllowedVideos.add(video);
    // click (capture) fires before the player's own click handler.
    // Remember if the video was paused NOW (before the player toggles state).
    // After the click fully settles, if it's still paused → resume it.
    // This covers both: player calls play() itself (wasPaused check → no-op)
    // and players that don't auto-resume (deferred play() kicks in).
    // Crucially: if the player paused a PLAYING video on click, wasPaused=false
    // so we never fight that intentional pause.
    if (event.type === 'click') {
      const wasPaused = video.paused;
      if (wasPaused) {
        setTimeout(() => {
          if (video.paused && userAllowedVideos.has(video)) {
            const p = video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        }, 0);
      }
    }
  }

  function pauseVideoIfBlocked(video) {
    if (!videoPauseEnabled || userAllowedVideos.has(video)) return;
    if (!video.paused) video.pause();
  }

  function manageVideo(video) {
    if (!(video instanceof HTMLVideoElement) || managedVideos.has(video)) return;
    managedVideos.add(video);
    video.addEventListener('play', () => {
      if (!videoPauseEnabled || userAllowedVideos.has(video)) return;
      video.pause();
    }, true);
    video.addEventListener('pause', () => userAllowedVideos.delete(video), true);
    video.addEventListener('ended', () => userAllowedVideos.delete(video), true);
    pauseVideoIfBlocked(video);
  }

  function scanVideos(root = document.documentElement) {
    document.querySelectorAll('video').forEach(manageVideo);
    Array.from(walkAllElements(root)).forEach(el => {
      if (el.tagName === 'VIDEO') manageVideo(el);
    });
  }

  function startVideoPauseGuard() {
    videoPauseEnabled = true;
    document.addEventListener('pointerdown', allowVideoFromUser, true);
    document.addEventListener('click', allowVideoFromUser, true);
    scanVideos();

    if (videoPauseObserver) return;
    videoPauseObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'VIDEO') manageVideo(node);
          Array.from(walkAllElements(node)).forEach(el => {
            if (el.tagName === 'VIDEO') manageVideo(el);
          });
        }
      }
    });
    videoPauseObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function clearVideoPauseGuard() {
    videoPauseEnabled = false;
    if (videoPauseObserver) {
      videoPauseObserver.disconnect();
      videoPauseObserver = null;
    }
    document.removeEventListener('pointerdown', allowVideoFromUser, true);
    document.removeEventListener('click', allowVideoFromUser, true);
  }

  const SKIP_TAGS = new Set([
    'HTML','BODY','HEAD','SCRIPT','STYLE','LINK','META','NOSCRIPT',
    'IMG','VIDEO','IFRAME','CANVAS','EMBED','OBJECT','SVG','PICTURE','BR','HR','WBR'
  ]);

  function isInShadowDOM(el) { return el.getRootNode() instanceof ShadowRoot; }

  function isSvgPart(el) {
    return el instanceof SVGElement || el.closest?.('svg');
  }

  function isMediaSurface(el) {
    return el.matches?.(MEDIA_SELECTOR) || el.closest?.(MEDIA_SELECTOR);
  }

  function isMediaPlayerChrome(el) {
    return el.matches?.(MEDIA_PLAYER_SELECTOR) || el.closest?.(MEDIA_PLAYER_SELECTOR);
  }

  // Google Docs/Slides 编辑区选择器（仅计算一次）
  const _googleEditSel = (function() {
    if (location.hostname !== 'docs.google.com') return null;
    if (location.pathname.startsWith('/document/')) return '#kix-appview';
    if (location.pathname.startsWith('/presentation/')) return '.punch-viewer-content, #punch-slide-views';
    return null;
  })();

  function isGoogleEditArea(el) {
    return !!(_googleEditSel && el.closest?.(_googleEditSel));
  }

  function hasReadableTextDeep(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest?.(MEDIA_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    return Boolean(walker.nextNode());
  }

  function isInlineTextWrapper(el) {
    if (!hasReadableTextDeep(el)) return false;
    if (el.querySelector?.(MEDIA_SELECTOR)) return false;
    if (el.querySelector?.('button, input, textarea, select, [role="button"], [role="textbox"], [role="searchbox"]')) return false;

    const children = Array.from(el.children);
    if (!children.length) return true;
    if (children.length > 4) return false;

    return children.every(child =>
      INLINE_TEXT_TAGS.has(child.tagName) ||
      child.tagName === 'BR' ||
      child.tagName === 'WBR' ||
      child instanceof SVGElement
    );
  }

  function isTransparentColor(color) {
    return color === 'rgba(0, 0, 0, 0)' || color === 'transparent';
  }

  function hasUrlBackground(backgroundImage) {
    return backgroundImage !== 'none' && /url\(/i.test(backgroundImage);
  }

  function isMediaOnlyContainer(el, cs) {
    if (hasReadableTextDeep(el)) return false;
    if (hasUrlBackground(cs.backgroundImage)) return true;

    const media = el.querySelector?.(MEDIA_SELECTOR);
    if (!media) return false;
    return true;
  }

  function shouldOverrideBg(el) {
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (isGoogleEditArea(el)) return false;
    if (isSvgPart(el) || isMediaSurface(el) || isMediaPlayerChrome(el)) return false;
    const cs = window.getComputedStyle(el);
    if (hasUrlBackground(cs.backgroundImage)) return false;
    if (/gradient/i.test(cs.backgroundImage)) return false;
    if (['absolute', 'fixed'].includes(cs.position)) return false;
    if (isMediaOnlyContainer(el, cs)) return false;
    if (isInlineTextWrapper(el)) return false;
    if (!isTransparentColor(cs.backgroundColor)) {
      return !INLINE_TEXT_TAGS.has(el.tagName);
    }
    if (['inline', 'none', 'contents'].includes(cs.display)) return false;
    if (INLINE_TEXT_TAGS.has(el.tagName)) return false;
    return true;
  }

  function applyBgToEl(el, color) {
    if (!shouldOverrideBg(el)) return;
    el.style.setProperty('background-color', color, 'important');
    const bgImg = window.getComputedStyle(el).backgroundImage;
    if (bgImg !== 'none' && !hasUrlBackground(bgImg)) {
      el.style.setProperty('background-image', 'none', 'important');
    }
    el.setAttribute(BG_ATTR, '1');
  }

  function markOverlayEl(el) {
    if (SKIP_TAGS.has(el.tagName)) return;
    if (isSvgPart(el) || isMediaSurface(el) || isMediaPlayerChrome(el)) return;
    const cs = window.getComputedStyle(el);
    if (!isTransparentColor(cs.backgroundColor) || hasUrlBackground(cs.backgroundImage)) return;
    if (['absolute', 'fixed'].includes(cs.position)) {
      el.setAttribute(OVL_ATTR, '1');
    }
  }

  function injectShadowDarkStyle(shadowRoot, textCol) {
    if (shadowRoot.getElementById(SHADOW_DARK_ID)) return;
    const style = document.createElement('style');
    style.id = SHADOW_DARK_ID;
    style.textContent =
      `*:not(img):not(video):not(iframe):not(canvas):not(embed):not(object):not(picture):not(svg):not(svg *){color:${textCol}!important;background-color:transparent!important}`;
    shadowRoot.appendChild(style);
    shadowDarkRoots.add(shadowRoot);
  }

  function clearShadowDarkStyles() {
    for (const root of shadowDarkRoots) {
      root.getElementById(SHADOW_DARK_ID)?.remove();
    }
    shadowDarkRoots.clear();
  }

  function processEl(el, color, textCol) {
    if (isGoogleEditArea(el)) return; // 编辑区域由 CSS 高优先级规则保留原样，JS 完全不干预
    applyBgToEl(el, color);
    if (!isInShadowDOM(el)) markOverlayEl(el);
    if (textCol && el.shadowRoot) injectShadowDarkStyle(el.shadowRoot, textCol);
  }

  function clearBgJS() {
    bgProcessId++; // 取消当前正在执行的任何异步染色分块任务
    if (bgObserver) { bgObserver.disconnect(); bgObserver = null; }
    clearTimeout(bgMutTimer);
    clearTimeout(cssVarTimer);
    document.querySelectorAll(`[${BG_ATTR}]`).forEach(el => {
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
      el.removeAttribute(BG_ATTR);
    });
    document.querySelectorAll(`[${OVL_ATTR}]`).forEach(el => el.removeAttribute(OVL_ATTR));
    clearShadowDarkStyles();
  }

  function startDimJS(amount) {
    const pct = Math.min(90, Math.max(0, amount));
    const inv = Math.min(10, 1 / (1 - pct / 100));
    const invStr = `brightness(${inv.toFixed(6)})`;

    const _skipImgInv = location.hostname.includes('instagram.com') ||
                        (location.hostname.includes('google.com') && /[?&]tbm=isch/.test(location.search));
    // 图片类选择器：img/picture/svg，在 _skipImgInv 时不补偿
    const _IMG_SEL = 'img, picture, svg';

    function applyInv(el) {
      // Google Docs/Slides 编辑区容器本身：施加逆滤镜使其恢复正常亮度
      if (_googleEditSel && el.matches?.(_googleEditSel)) {
        el.style.setProperty('filter', invStr, 'important');
        el.setAttribute(DIM_ATTR, '1');
        return;
      }
      // 编辑区内部所有元素：父级已补偿，跳过
      if (isGoogleEditArea(el)) return;

      // 判断是否为媒体元素（标签 + computed background-image）
      const isTagMedia = el.matches?.(MEDIA_SELECTOR);
      let isBgMedia = false;
      if (!isTagMedia && !SKIP_TAGS.has(el.tagName)) {
        try { isBgMedia = hasUrlBackground(window.getComputedStyle(el).backgroundImage); } catch (e) {}
      }
      if (!isTagMedia && !isBgMedia) return;

      // IG / Google Images：img/picture/svg 及 background-image 容器随 body 暗化，不补偿
      if (_skipImgInv && (isBgMedia || el.matches?.(_IMG_SEL))) return;

      el.style.setProperty('filter', invStr, 'important');
      el.setAttribute(DIM_ATTR, '1');
    }

    Array.from(walkAllElements(document.documentElement)).forEach(applyInv);

    dimObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            applyInv(node);
            Array.from(walkAllElements(node)).forEach(applyInv);
          }
        }
      }
    });
    dimObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function clearDimJS() {
    if (dimObserver) { dimObserver.disconnect(); dimObserver = null; }
    document.querySelectorAll(`[${DIM_ATTR}]`).forEach(el => {
      el.style.removeProperty('filter');
      el.removeAttribute(DIM_ATTR);
    });
  }

  /* ── 性能优化：分块加载任务队列 ── */
  function startBgJS(color, textCol) {
    const currentProcessId = ++bgProcessId;
    if (document.readyState === 'complete') {
      injectCssVarOverrides(color);
    } else {
      window.addEventListener('load', () => {
        if (currentProcessId === bgProcessId) injectCssVarOverrides(color);
      }, { once: true });
    }

    // 预热：处理首屏可见的元素
    const elements = Array.from(walkAllElements(document.documentElement));
    let i = 0;
    function processChunk(deadline) {
      if (currentProcessId !== bgProcessId) return; // 若已被 disable 阻断，立即退出
      while (i < elements.length && (deadline ? deadline.timeRemaining() > 0 : true)) {
        processEl(elements[i++], color, textCol);
      }
      if (i < elements.length) {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(processChunk, { timeout: 500 });
        } else {
          setTimeout(processChunk, 16);
        }
      }
    }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(processChunk, { timeout: 200 });
    } else {
      processChunk(null);
    }

    // 观察并防抖处理动态加载的 DOM（如 X 的无限滚动）
    const pendingNodes = new Set();
    bgObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) pendingNodes.add(node);
        }
      }
      clearTimeout(bgMutTimer);
      bgMutTimer = setTimeout(() => {
        if (currentProcessId !== bgProcessId) return; // 若已被 disable 阻断，立即退出
        if (!pendingNodes.size) return;
        // 分批处理新增 DOM 节点，避免页面突发卡顿
        pendingNodes.forEach(node => {
          processEl(node, color, textCol);
          // 使用非阻塞迭代，避免同步深度遍历
          const subEls = Array.from(walkAllElements(node));
          subEls.forEach(el => processEl(el, color, textCol));
        });
        pendingNodes.clear();
      }, 80); // 增加防抖时间，大幅降低卡顿
    });

    bgObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ── 内置 CSS 库及处理 ── */
  const BUILTIN_CSS = {
    'win7-glass': `
html, body {
  background: #0f2740 !important;
  color: #101820 !important;
  font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background:
    radial-gradient(circle at 18% 8%, rgba(255,255,255,.45), transparent 18%),
    radial-gradient(circle at 82% 0%, rgba(118,190,255,.45), transparent 22%),
    linear-gradient(135deg, #12385a 0%, #5aa4d4 42%, #1d4a73 100%) !important;
}
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background: linear-gradient(180deg, rgba(255,255,255,.78), rgba(235,246,255,.62)) !important;
  border: 1px solid rgba(255,255,255,.9) !important;
  border-radius: 7px !important;
  box-shadow: 0 10px 28px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.9) !important;
  color: #111 !important;
}
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background: linear-gradient(180deg, #f7fbff 0%, #d8ebfb 48%, #b6d7ef 49%, #e7f5ff 100%) !important;
  border: 1px solid #5b8fb8 !important;
  border-radius: 4px !important;
  box-shadow: inset 0 1px #fff, 0 1px 1px rgba(0,0,0,.18) !important;
  color: #10243a !important;
  font-family: "Segoe UI", Tahoma, Arial, sans-serif !important;
}
button:hover, [role="button"]:hover {
  background: linear-gradient(180deg, #fff 0%, #e6f7ff 45%, #b8e8ff 46%, #edfaff 100%) !important;
  border-color: #2f86c2 !important;
}
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea, select {
  background: rgba(255,255,255,.92) !important;
  border: 1px solid #7f9db9 !important;
  border-radius: 3px !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.18) !important;
  color: #111 !important;
}
a, a:visited { color: #005a9e !important; }
img, video { border-radius: 4px !important; }
`,
    'system-css': `
html, body {
  background: #dedede !important;
  color: #111 !important;
  font-family: Chicago, "Geneva", "Lucida Grande", "Helvetica Neue", Arial, sans-serif !important;
}
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
  text-shadow: none !important;
}
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background: #dedede !important;
  border: 1px solid #000 !important;
  color: #111 !important;
}
header, nav, [role="banner"], [role="navigation"] {
  background:
    repeating-linear-gradient(0deg, #111 0 1px, #dedede 1px 3px) !important;
  color: #000 !important;
  border: 1px solid #000 !important;
}
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background: #dedede !important;
  border: 1px solid #000 !important;
  box-shadow: 1px 1px 0 #000 !important;
  color: #000 !important;
  font-family: Chicago, "Geneva", Arial, sans-serif !important;
}
button:active, [role="button"]:active {
  background: #c8c8c8 !important;
  box-shadow: none !important;
  transform: translate(1px, 1px) !important;
}
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea, select {
  background: #fff !important;
  border: 1px solid #000 !important;
  color: #000 !important;
}
a, a:visited { color: #0000ee !important; text-decoration: underline !important; }
hr, [role="separator"] { border: 0 !important; border-top: 1px solid #000 !important; }
`,
    'xp-css': `
html, body {
  background: #ece9d8 !important;
  color: #111 !important;
  font-family: Tahoma, "Trebuchet MS", Arial, sans-serif !important;
}
article, section, aside, main,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background: #ece9d8 !important;
  border: 1px solid #7f9db9 !important;
  border-radius: 3px !important;
  box-shadow: inset 1px 1px #fff, inset -1px -1px #aca899 !important;
  color: #111 !important;
}
header, nav, [role="banner"], [role="navigation"] {
  background: linear-gradient(180deg, #3d95ff 0%, #176de3 45%, #0755c8 46%, #2a74df 100%) !important;
  border: 1px solid #003c9d !important;
  border-radius: 4px 4px 0 0 !important;
  box-shadow: inset 0 1px rgba(255,255,255,.55) !important;
  color: #fff !important;
}
header *, nav *, [role="banner"] *, [role="navigation"] * { color: #fff !important; }
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background: linear-gradient(180deg, #fff 0%, #f5f3e8 45%, #e1dcc8 46%, #f7f4e9 100%) !important;
  border: 1px solid #003c74 !important;
  border-radius: 3px !important;
  box-shadow: inset 1px 1px #fff, inset -1px -1px #c7c2a5 !important;
  color: #111 !important;
  font-family: Tahoma, Arial, sans-serif !important;
}
button:hover, [role="button"]:hover {
  border-color: #ffb700 !important;
  background: linear-gradient(180deg, #fff 0%, #fff7d7 45%, #ffe28a 46%, #fff4bf 100%) !important;
}
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea, select {
  background: #fff !important;
  border: 1px solid #7f9db9 !important;
  border-radius: 2px !important;
  box-shadow: inset 1px 1px 2px rgba(0,0,0,.15) !important;
  color: #111 !important;
}
a, a:visited { color: #0000ee !important; }
table, th, td { border-color: #aca899 !important; }
`,
    'mac-osx': `
html, body {
  background: #e8e8e8 repeating-linear-gradient(0deg, #f4f4f4, #f4f4f4 2px, #e8e8e8 2px, #e8e8e8 4px) !important;
  color: #222 !important;
  font-family: "Lucida Grande", "Helvetica Neue", Helvetica, Arial, sans-serif !important;
}
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background: #ffffff !important;
  border: 1px solid #999 !important;
  border-radius: 5px !important;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2) !important;
  color: #222 !important;
}
header, nav, [role="banner"], [role="navigation"] {
  background: linear-gradient(180deg, #eeeeee 0%, #cccccc 100%) !important;
  border-bottom: 1px solid #777 !important;
  border-radius: 5px 5px 0 0 !important;
  box-shadow: inset 0 1px #fff !important;
  color: #111 !important;
}
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background: linear-gradient(180deg, #ffffff 0%, #f3f3f3 49%, #e0e0e0 51%, #f4f4f4 100%) !important;
  border: 1px solid #888 !important;
  border-radius: 14px !important;
  box-shadow: inset 0 1px #fff, 0 1px 1px rgba(0,0,0,0.1) !important;
  color: #222 !important;
  padding: 3px 12px !important;
  font-size: 13px !important;
  text-shadow: 0 1px #fff !important;
}
button:active, [role="button"]:active {
  background: linear-gradient(180deg, #a4caff 0%, #7db1f8 49%, #5494f1 51%, #8dc1fb 100%) !important;
  border-color: #3b6ba5 !important;
  color: #fff !important;
  text-shadow: 0 1px rgba(0,0,0,0.4) !important;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.3) !important;
}
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea, select {
  background: #fff !important;
  border: 1px solid #999 !important;
  border-top-color: #666 !important;
  border-radius: 4px !important;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.1) !important;
  color: #111 !important;
}
a, a:visited { color: #1a0dab !important; text-decoration: none !important; }
a:hover, a:visited:hover { text-decoration: underline !important; }
::-webkit-scrollbar { width: 14px; background: #ededed; border-left: 1px solid #ccc; }
::-webkit-scrollbar-thumb { background: linear-gradient(90deg, #e4e4e4, #c4c4c4); border: 1px solid #999; border-radius: 7px; box-shadow: inset 1px 0 #fff; }
`,
    '98-css': `
/* ════ WIN 98 SYSTEM THEME (Merged from Chaos) ════ */
html, body { background-color: #c0c0c0 !important; color: #000000 !important; }
*, *::before, *::after {
  border-radius: 0 !important;
  transition-duration: 0s !important;
  animation-duration: 0s !important;
  animation-fill-mode: both !important;
  animation-iteration-count: 1 !important;
  backdrop-filter: none !important;
  text-shadow: none !important;
  box-shadow: none !important;
}

/* ── Win95 beveled panels ── */
article, section, [class*="card"]:not(input):not(button),
[class*="post"]:not(input):not(button),
nav, aside, details, blockquote,
[role="complementary"], [role="region"], [role="toolbar"],
[role="menu"], [role="menubar"], [role="listbox"], [role="tree"],
[role="tabpanel"], [role="tablist"],
[role="dialog"], [role="alertdialog"],
[class*="sidebar"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="widget"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="dialog"]:not(input):not(button),
[class*="popup"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button),
[class*="drawer"]:not(input):not(button),
[class*="tooltip"]:not(input):not(button),
[class*="toast"]:not(input):not(button),
[class*="banner"]:not(input):not(button),
[class*="callout"]:not(input):not(button),
[class*="alert"]:not(input):not(button) {
  background-color: #c0c0c0 !important;
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
}

/* ── Modal/dialog title bar ── */
[role="dialog"] > *:first-child,
[class*="modal"] > *:first-child,
[class*="dialog"] > *:first-child {
  background: linear-gradient(90deg, #000080 0%, #1084d0 100%) !important;
  color: #ffffff !important;
  padding: 3px 6px !important;
  font-weight: bold !important;
  font-size: 12px !important;
}

/* ── Blockquote sunken well ── */
blockquote {
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 8px 12px !important;
  margin: 8px 0 !important;
  background-color: #ffffff !important;
  color: #000000 !important;
}

p { line-height: 1.9 !important; margin-bottom: 16px !important; word-spacing: 1px !important; }
li { margin-bottom: 9px !important; line-height: 1.7 !important; }

h1, h2, h3, h4, h5, h6 {
  letter-spacing: 2px !important;
  margin-top: 22px !important;
  margin-bottom: 14px !important;
  padding-bottom: 5px !important;
  border-bottom: 2px solid !important;
  border-color: #808080 transparent #dfdfdf transparent !important;
  font-weight: bold !important;
}
h1 { margin-left: 0 !important; }

/* ── Separators ── */
hr, [role="separator"] {
  border: none !important;
  border-top: 1px solid #808080 !important;
  border-bottom: 1px solid #ffffff !important;
  margin: 22px 0 !important;
  height: 0 !important;
  background-color: transparent !important;
}

/* ── Tables ── */
table { border-collapse: separate !important; border-spacing: 10px 16px !important; }
td, th {
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  padding: 4px 8px !important;
}
th { font-weight: bold !important; background-color: #c0c0c0 !important; }

/* ── Buttons ── */
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background-color: #c0c0c0 !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
  padding: 3px 10px !important;
  min-height: 0 !important;
  min-width: 0 !important;
  cursor: default !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
}
button:active, [role="button"]:active,
summary:active {
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040, inset -1px -1px #ffffff !important;
}
button svg, [role="button"] svg { fill: currentColor !important; stroke: none !important; color: #000000 !important; }

/* ── Extended button-like elements ── */
summary,
[role="tab"], [role="menuitem"], [role="option"],
[role="treeitem"], [role="gridcell"],
a[class*="btn"]:not([role="button"]),
a[class*="button"]:not([role="button"]),
[class*="-btn"]:not(input):not(button):not([role="button"]),
[class*="btn-"]:not(input):not(button):not([role="button"]),
[class*="-button"]:not(input):not(button):not([role="button"]),
[class*="chip"]:not(input):not(button),
[class*="tag"]:not(input):not(button):not(script) {
  background-color: #c0c0c0 !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
  padding: 2px 8px !important;
  cursor: default !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
}
[role="tab"]:active, [role="menuitem"]:active,
a[class*="btn"]:active, a[class*="button"]:active {
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040, inset -1px -1px #ffffff !important;
}
[role="tab"][aria-selected="true"] {
  background-color: #c0c0c0 !important;
  border-bottom-color: #c0c0c0 !important;
  z-index: 1 !important;
  position: relative !important;
}

input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea {
  background-color: #ffffff !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px 4px !important;
  min-height: 0 !important;
}
select {
  background-color: #ffffff !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
}

a:not([role="button"]), a:visited:not([role="button"]) {
  color: #000080 !important;
  text-decoration: underline !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  min-height: 0 !important;
}

::selection { background-color: #000080 !important; color: #ffffff !important; }

/* ── Images: sunken inset frame ── */
img:not([src^="data:"]) {
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  box-sizing: content-box !important;
  background-color: #c0c0c0 !important;
  vertical-align: middle !important;
}
video {
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  background-color: #000000 !important;
}
figure {
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
  padding: 8px !important;
  background-color: #c0c0c0 !important;
  display: inline-block !important;
}
figcaption {
  border-top: 1px solid #808080 !important;
  margin-top: 6px !important;
  padding-top: 4px !important;
  font-size: 11px !important;
  color: #444444 !important;
}
[class*="avatar"]:not(button):not(input),
[class*="thumbnail"]:not(button):not(input),
[class*="photo"]:not(button):not(input) {
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  background-color: #c0c0c0 !important;
}

[class*="css-175oi2r"][style*="background-image"] {
  background-color: transparent !important;
  background-size: cover !important;
}
`,
    'woodblock-css': `
@import url('https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&display=swap');
/* ════ WOODBLOCK PRINT (古籍木刻版) ════ */
html, body {
  background-color: #d7d1cb !important;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.06) 100%),
    repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(0,0,0,0.03) 20px, rgba(0,0,0,0.03) 21px) !important;
  color: #2b231f !important;
  letter-spacing: 1px !important;
  line-height: 1.8 !important;
}

/* 强制所有中英文、标签、伪元素使用古籍体，抹除现代无衬线体 */
*, *::before, *::after {
  font-family: Georgia, "LXGW WenKai TC", "Kaiti SC", "KaiTi", "STKaiti", serif !important;
  box-shadow: none !important;
}

/* --- 活字印刷偏移特效（模拟套印不准与手工排版误差） --- */
/* 1. 内联文本与字符微小上下偏移 */
span:nth-child(5n+1), a:nth-child(5n+1), b:nth-child(5n+1), strong:nth-child(5n+1), em:nth-child(5n+1), i:nth-child(5n+1), code:nth-child(5n+1) { position: relative !important; top: 0.5px !important; left: -0.5px !important; }
span:nth-child(5n+2), a:nth-child(5n+2), b:nth-child(5n+2), strong:nth-child(5n+2), em:nth-child(5n+2), i:nth-child(5n+2), code:nth-child(5n+2) { position: relative !important; top: -0.5px !important; left: 0.5px !important; }
span:nth-child(5n+3), a:nth-child(5n+3), b:nth-child(5n+3), strong:nth-child(5n+3), em:nth-child(5n+3), i:nth-child(5n+3), code:nth-child(5n+3) { position: relative !important; top: 1px !important; left: 0px !important; }
span:nth-child(5n+4), a:nth-child(5n+4), b:nth-child(5n+4), strong:nth-child(5n+4), em:nth-child(5n+4), i:nth-child(5n+4), code:nth-child(5n+4) { position: relative !important; top: -1px !important; left: -0.5px !important; }
span:nth-child(5n+0), a:nth-child(5n+0), b:nth-child(5n+0), strong:nth-child(5n+0), em:nth-child(5n+0), i:nth-child(5n+0), code:nth-child(5n+0) { position: relative !important; top: 0px !important; left: 1px !important; }

/* 2. 块级元素和UI的轻微倾斜、错位 */
p:nth-child(odd), li:nth-child(odd), h1:nth-child(odd), h2:nth-child(odd), h3:nth-child(odd), button:nth-child(odd), img:nth-child(odd) { transform: translate(0.5px, 0.5px) rotate(0.15deg) !important; }
p:nth-child(even), li:nth-child(even), h1:nth-child(even), h2:nth-child(even), h3:nth-child(even), button:nth-child(even), img:nth-child(even) { transform: translate(-0.5px, -0.5px) rotate(-0.15deg) !important; }
div:nth-child(3n+1) { transform: translate(0.5px, 0px) !important; }
div:nth-child(3n+2) { transform: translate(-0.5px, 0.5px) !important; }
/* ---------------------------------------------------- */

/* 核心：去除边框，回归极简平整 */
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background-color: transparent !important;
  border: 1px solid #2b231f !important;
  border-radius: 0 !important;
}

/* 按钮：ASCII 标点组成 */
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background-color: transparent !important;
  color: #2b231f !important;
  border: none !important;
  border-radius: 0 !important;
  padding: 4px 16px !important;
  font-weight: bold !important;
  cursor: pointer !important;
}
button::before, input[type="button"]::before, input[type="submit"]::before, input[type="reset"]::before,
[role="button"]:not(:has(button, [role="button"]))::before {
  content: ".~ " !important;
  color: #2b231f !important;
}
button::after, input[type="button"]::after, input[type="submit"]::after, input[type="reset"]::after,
[role="button"]:not(:has(button, [role="button"]))::after {
  content: " ~." !important;
  color: #2b231f !important;
}
button:active, [role="button"]:active {
  transform: translate(1px, 1px) !important;
}

/* 输入框 */
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"]),
textarea, select {
  background-color: rgba(255,255,255,0.3) !important;
  color: #2b231f !important;
  border: none !important;
  border-bottom: 1px solid #2b231f !important;
  border-radius: 0 !important;
  padding: 4px 8px !important;
}

/* 链接：朱砂红 */
a, a:visited {
  color: #8b2615 !important;
  text-decoration: none !important;
  border-bottom: 1px dashed #8b2615 !important;
}
a:hover, a:visited:hover {
  color: #b0301a !important;
  border-bottom: 2px solid #b0301a !important;
}

/* 标题：加粗并加双线底边 */
h1, h2, h3, h4, h5, h6 {
  font-weight: 900 !important;
  color: #2b231f !important;
  border-bottom: 3px double #2b231f !important;
  padding-bottom: 6px !important;
  margin-bottom: 12px !important;
}

/* 图片/视频：做泛黄复古褪色处理并加上简单的方正边框 */
img, video, canvas, picture {
  filter: sepia(0.5) contrast(0.9) brightness(0.85) !important;
  border: 1px solid #2b231f !important;
  border-radius: 0 !important;
  padding: 4px !important;
  background-color: #d7d1cb !important;
}

/* 分界线：ASCII 标点组成 */
hr, [role="separator"] {
  border: 0 !important;
  height: 1.5em !important;
  overflow: hidden !important;
  text-align: center !important;
  background: transparent !important;
}
hr::after, [role="separator"]::after {
  content: ".~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~.~." !important;
  color: #2b231f !important;
  letter-spacing: 4px !important;
  display: block !important;
  white-space: nowrap !important;
}
::selection { background-color: #8b2615 !important; color: #d7d1cb !important; }
`,
    'pet-terminal': '',
    'lcd': ''
  };

  const LAYOUT_PROPS = new Set([
    'width','height','min-width','max-width','min-height','max-height','margin','padding',
    'display','position','top','right','bottom','left','z-index','flex','grid','box-sizing',
    'font-size','line-height'
  ]);

  function boostRule(rule) {
    if (rule instanceof CSSStyleRule) {
      const style = rule.style;
      const decls = [];
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        const val = style.getPropertyValue(prop);
        const important = LAYOUT_PROPS.has(prop) ? '' : ' !important';
        decls.push(`  ${prop}: ${val}${important};`);
      }
      return `${rule.selectorText} {\n${decls.join('\n')}\n}`;
    }
    return rule.cssText;
  }

  function parseAndBoost(cssText) {
    const tmp = document.createElement('style');
    tmp.textContent = cssText;
    injectToRoot(tmp);
    let result = '';
    try { result = Array.from(tmp.sheet.cssRules).map(boostRule).join('\n'); } catch {}
    tmp.remove();
    return result;
  }

  async function loadLibrary(lib) {
    if (!lib.url && !BUILTIN_CSS[lib.id]) return;
    if (BUILTIN_CSS[lib.id]) {
      const style = document.createElement('style');
      style.setAttribute(LIB_ATTR, lib.id);
      style.textContent = parseAndBoost(BUILTIN_CSS[lib.id]);
      injectToRoot(style);
      return;
    }
    try {
      const res = await fetch(lib.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const style = document.createElement('style');
      style.setAttribute(LIB_ATTR, lib.id);
      style.textContent = parseAndBoost(await res.text());
      injectToRoot(style);
    } catch {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = lib.url;
      link.setAttribute(LIB_ATTR, lib.id);
      injectToRoot(link);
    }
  }

  /* ── 智能暗色模式原生检测 ── */
  function runNativeDarkCheck(settings) {
    if (!document.body || settings.darkMode !== 'smartdark' || nativeDarkDetected) return;

    const html = document.documentElement;
    const body = document.body;

    // 1. 检查语义化的属性和类名 (如 Tailwind 的 .dark，各种 data-theme)
    const attrDark = /(?:^|\s|-)(dark|night)(?:$|\s|-)/i;
    const isClassDark = attrDark.test(html.className) || attrDark.test(body.className);
    const isDataDark = ['data-theme', 'data-mode', 'data-color-mode'].some(attr =>
      (html.getAttribute(attr) || '').toLowerCase().includes('dark') ||
      (body.getAttribute(attr) || '').toLowerCase().includes('dark')
    ) || html.getAttribute('dark') === 'true' || body.getAttribute('dark') === 'true';

    if (isClassDark || isDataDark) {
      nativeDarkDetected = true;
    } else {
      // 2. 临时禁用注入的样式以读取网页原生的计算样式
      const styleEl = document.getElementById(STYLE_ID);
      const varsEl = document.getElementById(VARS_STYLE_ID);
      const wasStyleDisabled = styleEl ? styleEl.disabled : false;
      const wasVarsDisabled = varsEl ? varsEl.disabled : false;

      if (styleEl) styleEl.disabled = true;
      if (varsEl) varsEl.disabled = true;

      // 强制同步重排，确保获取到未被我们 CSS 覆盖的真实计算样式
      void body.offsetHeight;

      const csHtml = window.getComputedStyle(html);
      const csBody = window.getComputedStyle(body);

      // 精确匹配：仅当 dark 是首选（第一位），或声明 only dark 时判定为原生暗色。
      // 'light dark' 表示"两者皆支持，默认浅色"，须结合 OS 实际偏好才能判定。
      const rawScheme = (csHtml.colorScheme || csBody.colorScheme || '').trim().toLowerCase();
      const schemeTokens = rawScheme.replace(/^only\s+/, '').split(/[\s,]+/).filter(t => t === 'dark' || t === 'light');
      const darkIsFirst = schemeTokens[0] === 'dark';
      const supportsDark = schemeTokens.includes('dark');
      const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (darkIsFirst || (supportsDark && osDark)) {
        nativeDarkDetected = true;
      } else {
        // 3. 如果底层透明，向下探测主容器的物理亮度 (SPA 框架特性)
        let bg = csBody.backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = csHtml.backgroundColor;
        
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
          const mainContainers = [
            document.getElementById('root'),
            document.getElementById('app'),
            document.querySelector('main'),
            body.firstElementChild
          ].filter(Boolean);
          
          for (const el of mainContainers) {
            const cs = window.getComputedStyle(el);
            if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
              bg = cs.backgroundColor;
              break;
            }
          }
        }

        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match) {
            const r = parseInt(match[1], 10), g = parseInt(match[2], 10), b = parseInt(match[3], 10);
            // 使用相对亮度公式，如果亮度低于 0.3，则判定为原生暗色模式
            if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.3) nativeDarkDetected = true;
          }
        } else {
          // 4. 终极反推：如果背景依然未知，但全局文字是浅色/白色的，绝对是暗黑模式！
          const textColor = csBody.color || csHtml.color;
          if (textColor) {
            const match = textColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
              const r = parseInt(match[1], 10), g = parseInt(match[2], 10), b = parseInt(match[3], 10);
              if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7) nativeDarkDetected = true;
            }
          }
        }
      }

      // 极速恢复样式（由于是同步 JS 进程，肉眼完全无法察觉禁用与恢复）
      if (styleEl) styleEl.disabled = wasStyleDisabled;
      if (varsEl) varsEl.disabled = wasVarsDisabled;
    }

    if (nativeDarkDetected) {
      loadAndApply(); // 发现原生暗色后，立刻获取最新配置并重载（防止旧配置覆盖新操作）
    }
  }

  let checkTimeout = null;
  function scheduleNativeDarkCheck(settings) {
    if (hasCheckedNativeDark || nativeDarkDetected) return;
    runNativeDarkCheck(settings);
    
    // SPA 延迟二次补偿探测 (为 Vue/React/Angular 延迟渲染预留 2000ms)
    if (!nativeDarkDetected) {
      clearTimeout(checkTimeout);
      checkTimeout = setTimeout(() => {
        if (!nativeDarkDetected) runNativeDarkCheck(settings);
        hasCheckedNativeDark = true;
      }, 2000);
    }
  }

  /* ── 特效板块：Horizontal Page Flip ── */

  function detectFlipPages() {
    const SKIP = new Set(['SCRIPT','STYLE','LINK','META','NOSCRIPT','HEADER','FOOTER','NAV','ASIDE']);
    const hasSize = el => { const r = el.getBoundingClientRect(); return r.width > 150 && r.height > 60; };

    // Phase 1: semantic + social media
    const phase1 = [
      'article',
      '[role="article"]',
      '[data-testid="tweet"]',
      '[role="feed"] > *',
      '[role="listitem"]',
      'main > ul > li',
      'main > ol > li',
      'section',
    ];
    for (const sel of phase1) {
      try {
        const els = Array.from(document.querySelectorAll(sel)).filter(hasSize);
        if (els.length >= 2) return els.slice(0, 60);
      } catch {}
    }

    // Phase 2: content containers with the most visible children
    const containers = [
      ...Array.from(document.querySelectorAll(
        'main,[role="main"],#main,#content,.content,.feed,.timeline,.posts,.stream,[class*="feed"],[class*="list"],[class*="timeline"],[class*="stream"]'
      )),
      document.body,
    ];
    let best = [];
    for (const c of containers) {
      const kids = Array.from(c.children).filter(el => !SKIP.has(el.tagName) && hasSize(el));
      if (kids.length > best.length) best = kids;
      if (best.length >= 5) break;
    }
    if (best.length >= 2) return best.slice(0, 60);

    // Phase 3: find sibling group with most members across entire DOM
    const byParent = new Map();
    document.querySelectorAll('div,li,section,article').forEach(el => {
      if (SKIP.has(el.tagName) || !hasSize(el)) return;
      const p = el.parentElement;
      if (!p) return;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(el);
    });
    let top = [];
    byParent.forEach(g => { if (g.length > top.length) top = g; });
    return top.length >= 2 ? top.slice(0, 60) : [];
  }

  function getFlipBgColor() {
    const t = c => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    const b = window.getComputedStyle(document.body).backgroundColor;
    if (!t(b)) return b;
    const h = window.getComputedStyle(document.documentElement).backgroundColor;
    return t(h) ? '#ffffff' : h;
  }

  function applyFlipReformat(pages) {
    // Tag each page element so CSS can target it
    pages.forEach((el, i) => el.setAttribute('data-soe-flip-page', i));

    // Build ancestor chain from feedRoot up to (not including) body
    const feedRoot = pages[0]?.parentElement;
    if (feedRoot && feedRoot !== document.body && feedRoot !== document.documentElement) {
      const chain = new Set();
      let node = feedRoot;
      while (node && node !== document.body && node !== document.documentElement) {
        chain.add(node);
        node = node.parentElement;
      }
      // At each level, hide siblings that are outside the content tree
      chain.forEach(anc => {
        const parent = anc.parentElement;
        if (!parent || parent === document.documentElement) return;
        Array.from(parent.children).forEach(child => {
          if (!chain.has(child)) child.setAttribute('data-soe-flip-hide', '1');
        });
      });
    }

    const style = document.createElement('style');
    style.id = FLIP_REFORMAT_ID;
    style.textContent =
      '[data-soe-flip-hide]{display:none!important}' +
      '[data-soe-flip-page]{scroll-margin-top:0!important;outline:none!important}';
    document.head.appendChild(style);
  }

  function clearFlipReformat() {
    document.getElementById(FLIP_REFORMAT_ID)?.remove();
    document.querySelectorAll('[data-soe-flip-page]').forEach(el => el.removeAttribute('data-soe-flip-page'));
    document.querySelectorAll('[data-soe-flip-hide]').forEach(el => el.removeAttribute('data-soe-flip-hide'));
  }

  function startPageFlipEffect() {
    if (pageFlipActive) clearPageFlipEffect();

    const doStart = () => {
      const pages = detectFlipPages();
      if (!pages.length) return;

      pageFlipPages = pages;
      pageFlipActive = true;
      pageFlipTotal = pages.length;
      pageFlipCurrent = 0;

      applyFlipReformat(pages);

      // Scroll to first element immediately
      pages[0].scrollIntoView({ behavior: 'instant', block: 'start' });

      const bg = getFlipBgColor();
      const isDark = (() => { const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? (0.299*m[1]+0.587*m[2]+0.114*m[3])/255 < 0.5 : false; })();
      const navBg = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.58)';

      const style = document.createElement('style');
      style.id = FLIP_STYLE_ID;
      style.textContent = `
#${FLIP_NAV_ID}{position:fixed!important;bottom:20px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:flex!important;align-items:center!important;gap:14px!important;background:${navBg}!important;backdrop-filter:blur(12px)!important;color:#fff!important;padding:8px 20px!important;border-radius:999px!important;font:14px/1 system-ui,sans-serif!important;user-select:none!important;white-space:nowrap!important;pointer-events:none!important}
#soe-flip-left,#soe-flip-right{pointer-events:all!important;cursor:pointer!important;opacity:.8!important;padding:2px 8px!important;font-size:16px!important}
#soe-flip-left:hover,#soe-flip-right:hover{opacity:1!important}
#soe-flip-left.soe-disabled,#soe-flip-right.soe-disabled{opacity:.22!important;cursor:default!important;pointer-events:none!important}
.soe-flip-curtain{position:fixed!important;inset:0!important;z-index:2147483646!important;background:${bg}!important;pointer-events:none!important;transition:transform .22s cubic-bezier(.4,0,.2,1)!important}
`;
      document.head.appendChild(style);

      const nav = document.createElement('div');
      nav.id = FLIP_NAV_ID;
      nav.innerHTML = `<span id="soe-flip-left">&#9664;</span><span id="soe-flip-counter">1 / ${pages.length}</span><span id="soe-flip-right">&#9654;</span>`;
      document.documentElement.appendChild(nav);
      nav.querySelector('#soe-flip-left').addEventListener('click', () => goFlipPage(pageFlipCurrent - 1));
      nav.querySelector('#soe-flip-right').addEventListener('click', () => goFlipPage(pageFlipCurrent + 1));
      updateFlipNav();

      // Watch for infinite-scroll new content
      const feedRoot = pages[0]?.parentElement || document.body;
      pageFlipObserver = new MutationObserver(() => {
        const fresh = detectFlipPages();
        if (fresh.length > pageFlipPages.length) {
          pageFlipPages = fresh;
          pageFlipTotal = fresh.length;
          updateFlipNav();
        }
      });
      pageFlipObserver.observe(feedRoot, { childList: true });

      pageFlipKeyHandler = e => {
        if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
        if (document.activeElement?.isContentEditable) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goFlipPage(pageFlipCurrent + 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goFlipPage(pageFlipCurrent - 1); }
      };
      document.addEventListener('keydown', pageFlipKeyHandler, true);
    };

    // Delay for SPA (React/Vue) to finish rendering
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(doStart, 600), { once: true });
    } else {
      setTimeout(doStart, 350);
    }
  }

  function goFlipPage(idx) {
    const total = pageFlipTotal;
    idx = Math.max(0, Math.min(total - 1, idx));
    if (idx === pageFlipCurrent) return;

    const dir = idx > pageFlipCurrent ? 1 : -1;
    const target = pageFlipPages[idx];
    if (!target) return;

    // Slide curtain in from the incoming direction
    const curtain = document.createElement('div');
    curtain.className = 'soe-flip-curtain';
    curtain.style.transform = `translateX(${dir * 100}%)`;
    document.documentElement.appendChild(curtain);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      curtain.style.transform = 'translateX(0)';
    }));

    setTimeout(() => {
      pageFlipCurrent = idx;
      // Ensure element is still in DOM (virtual lists may replace it)
      if (!document.contains(target)) {
        const fresh = detectFlipPages();
        if (fresh.length) { pageFlipPages = fresh; pageFlipTotal = fresh.length; }
      }
      const el = pageFlipPages[pageFlipCurrent];
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      updateFlipNav();

      requestAnimationFrame(() => {
        curtain.style.transform = `translateX(${-dir * 100}%)`;
        setTimeout(() => curtain.remove(), 240);
      });
    }, 230);
  }

  function updateFlipNav() {
    const counter = document.getElementById('soe-flip-counter');
    if (counter) counter.textContent = `${pageFlipCurrent + 1} / ${pageFlipTotal}`;
    document.getElementById('soe-flip-left')?.classList.toggle('soe-disabled', pageFlipCurrent === 0);
    document.getElementById('soe-flip-right')?.classList.toggle('soe-disabled', pageFlipCurrent === pageFlipTotal - 1);
  }

  function clearPageFlipEffect() {
    if (!pageFlipActive) return;
    pageFlipActive = false;
    if (pageFlipKeyHandler) {
      document.removeEventListener('keydown', pageFlipKeyHandler, true);
      pageFlipKeyHandler = null;
    }
    if (pageFlipObserver) { pageFlipObserver.disconnect(); pageFlipObserver = null; }
    clearFlipReformat();
    document.getElementById(FLIP_NAV_ID)?.remove();
    document.getElementById(FLIP_STYLE_ID)?.remove();
    document.querySelectorAll('.soe-flip-curtain').forEach(el => el.remove());
    pageFlipPages = [];
    pageFlipCurrent = 0;
    pageFlipTotal = 0;
  }

  /* ── 核心启动逻辑 ── */
  function applySettings(settings) {
    removeInjected();
    if (isSiteDisabled(settings)) {
      clearVideoPauseGuard();
      return;
    }

    if (settings.pauseVideosEnabled) startVideoPauseGuard();
    else clearVideoPauseGuard();

    const flipEnabled = !!(settings.pageFlipEnabled && !isSiteDisabled(settings));
    if (flipEnabled !== pageFlipWasEnabled) {
      if (flipEnabled) startPageFlipEffect();
      else clearPageFlipEffect();
      pageFlipWasEnabled = flipEnabled;
    }

    if (!settings.enabled) return;

    const buildSettings = { ...settings };
    if (buildSettings.darkMode === 'smartdark' && nativeDarkDetected) {
      // removeInjected() 已在函数头部清除所有注入样式，此时 getComputedStyle 反映页面原生值
      let bg = window.getComputedStyle(document.body).backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = window.getComputedStyle(document.documentElement).backgroundColor;
      const m = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const bgIsLight = m && (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 > 0.7;
      if (!bgIsLight) buildSettings.darkMode = 'off'; // 确认原生暗色，主动退让
    }

    const css = buildCSS(buildSettings);
    if (css.trim()) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      injectToRoot(style);
    }

    (settings.cssLibraries || []).filter(l => l.enabled).forEach(lib => loadLibrary(lib));

    const retroActive = (settings.cssLibraries || []).some(l => l.enabled && l.id === '98-css');
    const bgColor = settings.bgEnabled && settings.backgroundColor ? settings.backgroundColor
      : buildSettings.darkMode === 'smartdark' ? '#1a1a1a'
      : buildSettings.darkMode === 'lightmode' ? '#bebebe'
      : retroActive ? '#bebebe'
      : null;
    let shadowTextCol = null;
    if (buildSettings.darkMode === 'smartdark') {
      const contrast = Math.min(100, Math.max(0, settings.smartDarkContrast ?? 75));
      const textV = Math.round(150 + (contrast / 100) * 105);
      shadowTextCol = `rgb(${textV},${Math.max(0, textV - 4)},${Math.max(0, textV - 8)})`;
    } else if (buildSettings.darkMode === 'lightmode') {
      shadowTextCol = (settings.textEnabled && settings.textColor) ? settings.textColor : '#000000';
    }
    if (bgColor) startBgJS(bgColor, shadowTextCol);
    if (settings.darkMode === 'dim') startDimJS(settings.dimAmount ?? 30);
  }

  function saveSettingsCache(settings) {
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({
        enabled: settings.enabled,
        darkMode: settings.darkMode,
        bgEnabled: settings.bgEnabled,
        backgroundColor: settings.backgroundColor,
        disabledSites: settings.disabledSites || [],
      }));
    } catch(e) {}
  }

  function loadAndApply() {
    chrome.storage.sync.get(null, settings => {
      if (chrome.runtime.lastError) return;

      // 应用当前站点专属设置（覆盖全局）
      const siteHostname = normalizeSiteHost(location.hostname);
      if (settings.siteSettings?.[siteHostname]) {
        Object.assign(settings, settings.siteSettings[siteHostname]);
      }

      saveSettingsCache(settings);

      // 用户主动将 darkMode 切换到 smartdark 时，重置原生检测标志，允许重新探测
      if (settings.darkMode === 'smartdark' && lastAppliedDarkMode !== 'smartdark') {
        nativeDarkDetected = false;
        hasCheckedNativeDark = false;
        clearTimeout(checkTimeout);
      }
      lastAppliedDarkMode = settings.darkMode;

      applySettings(settings);

      // 仅在插件启用且当前网站没有被 Disable 时，才执行智能原生探测
      if (settings.enabled && !isSiteDisabled(settings) && settings.darkMode === 'smartdark' && !hasCheckedNativeDark) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => scheduleNativeDarkCheck(settings), { once: true });
        } else {
          scheduleNativeDarkCheck(settings);
        }
      }
    });
  }

  // 保证尽可能早地执行注入
  loadAndApply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndApply);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') loadAndApply();
  });
})();
