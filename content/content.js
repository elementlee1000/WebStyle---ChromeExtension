(function () {
  const STYLE_ID      = 'style-override-ext';
  const VARS_STYLE_ID = 'style-override-ext-vars';
  const LIB_ATTR      = 'data-style-override-lib';
  const BG_ATTR       = 'data-soe-bg';
  const OVL_ATTR      = 'data-soe-transparent';
  const DIM_ATTR      = 'data-soe-dim';
  let bgObserver = null;
  let bgMutTimer = null;
  let cssVarTimer = null;
  let dimObserver = null;
  let videoPauseObserver = null;
  let videoPauseEnabled = false;
  const managedVideos = new WeakSet();
  const userAllowedVideos = new WeakSet();

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
    [STYLE_ID, VARS_STYLE_ID].forEach(id => document.getElementById(id)?.remove());
    document.querySelectorAll(`[${LIB_ATTR}]`).forEach(e => e.remove());
    clearBgJS();
    clearDimJS();
  }

  function normalizeSiteHost(hostname) {
    return (hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isSiteDisabled(settings) {
    const host = normalizeSiteHost(location.hostname);
    return (settings.disabledSites || []).some(site => {
      const disabled = normalizeSiteHost(site);
      return host === disabled || host.endsWith('.' + disabled);
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
a, a * { color: ${linkCol} !important; }
a:visited, a:visited * { color: #c7a7ff !important; }
small, .muted, [class*="muted"], [class*="secondary"], [class*="meta"],
[class*="subtle"], [aria-disabled="true"], [disabled] { color: ${mutedCol} !important; }
th { background-color: #252525 !important; }
::-webkit-scrollbar { background-color: #1a1a1a; }
::-webkit-scrollbar-thumb { background-color: #444; }
`;
    }

    if (s.darkMode === 'dim') {
      const pct = Math.min(90, Math.max(0, s.dimAmount ?? 30));
      const br  = (1 - pct / 100).toFixed(6);
      css += `
/* ── Dim ── */
body { filter: brightness(${br}) !important; }
`;
    }

    if (s.textEnabled && s.textColor) css += `body, body * { color: ${s.textColor} !important; }\n`;
    if (s.fontFamilyEnabled && s.fontFamily) css += `html, body, body * { font-family: ${s.fontFamily} !important; }\n`;
    if (s.fontSizeEnabled && s.fontSize) css += `html { font-size: ${s.fontSize}px !important; }\n`;
    if (s.customCSS) css += s.customCSS + '\n';

    const retroIds = ['98-css'];
    const hasRetro = (s.cssLibraries || []).some(l => l.enabled && retroIds.includes(l.id));
    if (hasRetro) {
      if (!s.bgEnabled) css += bgRule('#bebebe');
      css += `
/* ════ WIN 95/98 SYSTEM THEME ════ */

/* 1. Global aesthetic reset — strip all modern decorative effects */
*, *::before, *::after {
  border-radius: 0 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: both !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  text-shadow: none !important;
  box-shadow: none !important;
}

/* 2. Buttons — raised bevel (only semantic button elements & role="button" leaves) */
button,
input[type="button"],
input[type="submit"],
input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background-color: #c0c0c0 !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
  padding: 3px 8px !important;
  min-height: 0 !important;
  min-width: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
  cursor: default !important;
}
button:active, input[type="button"]:active, input[type="submit"]:active,
input[type="reset"]:active, [role="button"]:active {
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040, inset -1px -1px #ffffff !important;
}
button svg, [role="button"] svg,
input[type="button"] svg, input[type="submit"] svg, input[type="reset"] svg {
  fill: currentColor !important;
  stroke: none !important;
  color: #000000 !important;
}

/* 4. Text inputs — sunken well (white) */
input:not([type="button"], [type="submit"], [type="reset"],
          [type="checkbox"], [type="radio"], [type="range"],
          [type="file"], [type="color"]),
textarea {
  background-color: #ffffff !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px 4px !important;
  min-height: 0 !important;
  min-width: 0 !important;
}
select {
  background-color: #ffffff !important;
  color: #000000 !important;
  border: 2px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  min-height: 0 !important;
  min-width: 0 !important;
}

/* 5. Separators — 2px sunken rule (NOT a box) */
hr, [role="separator"] {
  border: none !important;
  border-top: 1px solid #808080 !important;
  border-bottom: 1px solid #ffffff !important;
  height: 0 !important;
  min-height: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin: 4px 0 !important;
  background-color: transparent !important;
  display: block !important;
}

/* 6. Links — plain blue underline, not a box */
a:not([role="button"]) {
  color: #000080 !important;
  text-decoration: underline !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  min-height: 0 !important;
  min-width: 0 !important;
}

/* 7. Selection */
::selection { background-color: #000080 !important; color: #ffffff !important; }

/* 8. X/Twitter: protect image-based avatar/media containers */
[class*="css-175oi2r"][style*="background-image"] {
  background-color: transparent !important;
  background-size: cover !important;
}
`;
    }

    if ((s.cssLibraries || []).some(l => l.enabled && l.id === 'chaos')) {
      const t   = Math.min(1, Math.max(0, (s.chaosIntensity  ?? 50) / 100));
      const bw  = Math.min(4, Math.max(1, s.chaosBorderWidth ?? 2));

      /* scale offset values by intensity; mw interpolates max-width toward 100% at t=0 */
      const p  = v => Math.round(v * t) + 'px';
      const mw = v => Math.round(100 + (v - 100) * t) + '%';

      /* random offsets — regenerated on every page load, scaled by intensity */
      const rPm  = () => Math.round((Math.random() * 2 - 1) * 24 * t);        // ±24px  position
      const rPos = () => Math.round(Math.random() * 30 * t);                  // 0–30px padding/margin
      const rWid = () => Math.round(100 - Math.random() * 30 * t);            // 70–100% max-width
      const rMar = () => Math.round((Math.random() * 32 - 12) * t);           // -12…+20px margin-top

      const posA  = Array.from({length: 5}, () => [rPm(), rPm()]);            // [top, left] × 5
      const widB  = Array.from({length: 7}, () => rWid());                    // max-width % × 7
      const padC  = Array.from({length: 3}, () => [rPos(), rPos(), rPos(), rPos()]); // [T,R,B,L] × 3
      const marD  = Array.from({length: 4}, () => rMar());                    // margin-top × 4
      const txtML = Array.from({length: 5}, () => rPos());                    // p margin-left × 5
      const liPL  = Array.from({length: 4}, () => rPos());                    // li padding-left × 4
      const hML   = Array.from({length: 3}, () => rPos());                    // h2/h3/h4 margin-left

      /* layout-scatter blocks are entirely omitted at t=0 so the page
         keeps its original positions/margins/padding (only style is applied) */
      const _scatterABCD = t > 0 ? `
/* ── A: Container position scatter (random per page load) ── */
div:nth-child(5n+1) { position: relative !important; top: ${posA[0][0]}px !important; left: ${posA[0][1]}px !important; }
div:nth-child(5n+2) { position: relative !important; top: ${posA[1][0]}px !important; left: ${posA[1][1]}px !important; }
div:nth-child(5n+3) { position: relative !important; top: ${posA[2][0]}px !important; left: ${posA[2][1]}px !important; }
div:nth-child(5n+4) { position: relative !important; top: ${posA[3][0]}px !important; left: ${posA[3][1]}px !important; }
div:nth-child(5n+0) { position: relative !important; top: ${posA[4][0]}px !important; left: ${posA[4][1]}px !important; }

/* ── B: Width scatter (random per page load) ── */
div:nth-child(7n+1) { max-width: ${widB[0]}% !important; }
div:nth-child(7n+2) { max-width: ${widB[1]}% !important; }
div:nth-child(7n+3) { max-width: ${widB[2]}% !important; }
div:nth-child(7n+4) { max-width: ${widB[3]}% !important; }
div:nth-child(7n+5) { max-width: ${widB[4]}% !important; }
div:nth-child(7n+6) { max-width: ${widB[5]}% !important; }
div:nth-child(7n+0) { max-width: ${widB[6]}% !important; }

/* ── C: Irregular inner padding (random per page load) ── */
div:nth-child(3n+1) { padding: ${padC[0][0]}px ${padC[0][1]}px ${padC[0][2]}px ${padC[0][3]}px !important; }
div:nth-child(3n+2) { padding: ${padC[1][0]}px ${padC[1][1]}px ${padC[1][2]}px ${padC[1][3]}px !important; }
div:nth-child(3n+0) { padding: ${padC[2][0]}px ${padC[2][1]}px ${padC[2][2]}px ${padC[2][3]}px !important; }

/* ── D: Vertical stacking (random per page load) ── */
div:nth-child(4n+1) { margin-top: ${marD[0]}px !important; z-index: 2 !important; }
div:nth-child(4n+2) { margin-top: ${marD[1]}px !important; }
div:nth-child(4n+3) { margin-top: ${marD[2]}px !important; z-index: 3 !important; }
div:nth-child(4n+0) { margin-top: ${marD[3]}px !important; }
` : '';

      const _panelPad = t > 0
        ? `  padding: ${p(14)} ${p(16)} !important;\n  margin: ${p(16)} ${p(8)} !important;`
        : '';

      const _textScatter = t > 0 ? `
/* ── Text-level scatter (random per page load) ── */
p:nth-of-type(5n+1) { margin-left: ${txtML[0]}px !important; }
p:nth-of-type(5n+2) { margin-left: ${txtML[1]}px !important; }
p:nth-of-type(5n+3) { margin-left: ${txtML[2]}px !important; }
p:nth-of-type(5n+4) { margin-left: ${txtML[3]}px !important; }
p:nth-of-type(5n+0) { margin-left: ${txtML[4]}px !important; }

li:nth-child(4n+1) { padding-left: ${liPL[0]}px !important; }
li:nth-child(4n+2) { padding-left: ${liPL[1]}px !important; }
li:nth-child(4n+3) { padding-left: ${liPL[2]}px !important; }
li:nth-child(4n+0) { padding-left: ${liPL[3]}px !important; }
` : '';

      const _hMLScatter = t > 0 ? `
h2 { margin-left: ${hML[0]}px !important; }
h3 { margin-left: ${hML[1]}px !important; }
h4 { margin-left: ${hML[2]}px !important; }
` : '';

      css += `
/* ════ CHAOS MODE: WIN95 SCATTERED STACK ════ */

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

${_scatterABCD}
/* ── E: Layer tones ── */
div:nth-child(6n+1) { background-color: #c0c0c0 !important; }
div:nth-child(6n+2) { background-color: #b8b8b8 !important; }
div:nth-child(6n+3) { background-color: #cacaca !important; }
div:nth-child(6n+4) { background-color: #bcbcbc !important; }
div:nth-child(6n+5) { background-color: #c8c8c8 !important; }
div:nth-child(6n+0) { background-color: #c4c4c4 !important; }

/* ── Win95 beveled panels ── */
article, section, [class*="card"]:not(input):not(button),
[class*="post"]:not(input):not(button) {
  border: ${bw}px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  box-shadow: inset 1px 1px #ffffff, inset -1px -1px #404040 !important;
${_panelPad}
}

/* ── Extended beveled borders on structural/widget elements ── */
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
  border: ${bw}px solid !important;
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

${_textScatter}
p { line-height: 1.9 !important; margin-bottom: 16px !important; word-spacing: 1px !important; }
li { margin-bottom: 9px !important; line-height: 1.7 !important; }

h1, h2, h3, h4, h5, h6 {
  letter-spacing: 2px !important;
  margin-top: 22px !important;
  margin-bottom: 14px !important;
  padding-bottom: 5px !important;
  border-bottom: ${bw}px solid !important;
  border-color: #808080 transparent #dfdfdf transparent !important;
  font-weight: bold !important;
}
h1 { margin-left: 0 !important; }
${_hMLScatter}

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
  border: ${bw}px solid !important;
  border-color: #dfdfdf #808080 #808080 #dfdfdf !important;
  padding: 4px 8px !important;
}
th { font-weight: bold !important; background-color: #c0c0c0 !important; }

/* ── Buttons ── */
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background-color: #c0c0c0 !important;
  color: #000000 !important;
  border: ${bw}px solid !important;
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
  border: ${bw}px solid !important;
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
  border: ${bw}px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px 4px !important;
  min-height: 0 !important;
}
select {
  background-color: #ffffff !important;
  color: #000000 !important;
  border: ${bw}px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
}

a:not([role="button"]) {
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
  border: ${bw}px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  box-sizing: content-box !important;
  background-color: #c0c0c0 !important;
  vertical-align: middle !important;
}
video {
  border: ${bw}px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  background-color: #000000 !important;
}
figure {
  border: ${bw}px solid !important;
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
  border: ${bw}px solid !important;
  border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
  box-shadow: inset 1px 1px #404040 !important;
  padding: 2px !important;
  background-color: #c0c0c0 !important;
}

[class*="css-175oi2r"][style*="background-image"] {
  background-color: transparent !important;
  background-size: cover !important;
}
`;
    }

    if (s.globalRadiusEnabled && typeof s.globalRadius === 'number') {
      const r = Math.max(0, s.globalRadius);
      css += `* , *::before, *::after { border-radius: ${r}px !important; }\n`;
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

  function findEventVideo(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.find(node => node instanceof HTMLVideoElement) || null;
  }

  function allowVideoFromUser(event) {
    const video = findEventVideo(event);
    if (!video) return;

    userAllowedVideos.add(video);
    if (video.paused) {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(() => {});
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
      queueMicrotask(() => pauseVideoIfBlocked(video));
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
    if (isSvgPart(el) || isMediaSurface(el) || isMediaPlayerChrome(el)) return false;
    const cs = window.getComputedStyle(el);
    if (hasUrlBackground(cs.backgroundImage)) return false;
    if (isMediaOnlyContainer(el, cs)) return false;
    if (isInlineTextWrapper(el)) return false;
    if (!isTransparentColor(cs.backgroundColor)) {
      return !INLINE_TEXT_TAGS.has(el.tagName);
    }
    if (['absolute', 'fixed'].includes(cs.position)) return false;
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

  function processEl(el, color) {
    applyBgToEl(el, color);
    if (!isInShadowDOM(el)) markOverlayEl(el);
  }

  function clearBgJS() {
    if (bgObserver) { bgObserver.disconnect(); bgObserver = null; }
    clearTimeout(bgMutTimer);
    document.querySelectorAll(`[${BG_ATTR}]`).forEach(el => {
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
      el.removeAttribute(BG_ATTR);
    });
    document.querySelectorAll(`[${OVL_ATTR}]`).forEach(el => el.removeAttribute(OVL_ATTR));
  }

  const DIM_MEDIA = new Set(['IMG','VIDEO','IFRAME','CANVAS']);

  function startDimJS(amount) {
    const pct = Math.min(90, Math.max(0, amount));
    const inv = Math.min(10, 1 / (1 - pct / 100));
    const invStr = `brightness(${inv.toFixed(6)})`;

    function applyInv(el) {
      if (DIM_MEDIA.has(el.tagName)) {
        el.style.setProperty('filter', invStr, 'important');
        el.setAttribute(DIM_ATTR, '1');
      }
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
  function startBgJS(color) {
    if (document.readyState === 'complete') {
      injectCssVarOverrides(color);
    } else {
      window.addEventListener('load', () => injectCssVarOverrides(color), { once: true });
    }

    // 预热：处理首屏可见的元素
    const elements = Array.from(walkAllElements(document.documentElement));
    let i = 0;
    function processChunk(deadline) {
      while (i < elements.length && (deadline ? deadline.timeRemaining() > 0 : true)) {
        processEl(elements[i++], color);
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
        if (!pendingNodes.size) return;
        // 分批处理新增 DOM 节点，避免页面突发卡顿
        pendingNodes.forEach(node => {
          processEl(node, color);
          // 使用非阻塞迭代，避免同步深度遍历
          const subEls = Array.from(walkAllElements(node));
          subEls.forEach(el => processEl(el, color));
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
a { color: #005a9e !important; }
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
a { color: #0000ee !important; text-decoration: underline !important; }
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
a { color: #0000ee !important; }
table, th, td { border-color: #aca899 !important; }
`,
    'pet-terminal': `
html, body {
  background: #001400 !important;
  color: #5cff5c !important;
  font-family: "Courier New", "Lucida Console", Consolas, monospace !important;
  text-shadow: 0 0 4px rgba(92,255,92,.65) !important;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  background: repeating-linear-gradient(0deg, rgba(92,255,92,.08) 0 1px, transparent 1px 4px) !important;
  mix-blend-mode: screen;
}
*, *::before, *::after {
  color: #5cff5c !important;
  border-color: #3cff3c !important;
  box-shadow: none !important;
  text-shadow: 0 0 4px rgba(92,255,92,.55) !important;
  border-radius: 0 !important;
}
html, body,
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button) {
  background: #001400 !important;
}
article, section, aside, main, nav, header, footer,
[role="dialog"], [role="menu"], [role="listbox"],
[class*="card"]:not(input):not(button),
[class*="panel"]:not(input):not(button),
[class*="modal"]:not(input):not(button),
[class*="sidebar"]:not(input):not(button),
[class*="dropdown"]:not(input):not(button),
table, th, td, fieldset {
  border-style: dashed !important;
  border-width: 1px !important;
}
hr, [role="separator"] {
  border: 0 !important;
  border-top: 1px dashed #5cff5c !important;
  background: transparent !important;
}
a {
  color: #9cff9c !important;
  text-decoration: underline !important;
  text-decoration-style: dashed !important;
}
button, input[type="button"], input[type="submit"], input[type="reset"],
[role="button"]:not(:has(button, [role="button"])) {
  background: #001400 !important;
  border: 1px dashed #5cff5c !important;
  color: #5cff5c !important;
  font-family: "Courier New", "Lucida Console", Consolas, monospace !important;
  text-transform: uppercase !important;
}
button::before, input[type="button"]::before, input[type="submit"]::before,
input[type="reset"]::before, [role="button"]:not(:has(button, [role="button"]))::before {
  content: "[ " !important;
}
button::after, input[type="button"]::after, input[type="submit"]::after,
input[type="reset"]::after, [role="button"]:not(:has(button, [role="button"]))::after {
  content: " ]" !important;
}
button:hover, [role="button"]:hover {
  background: #5cff5c !important;
  color: #001400 !important;
  text-shadow: none !important;
}
input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"]),
textarea, select {
  background: #001400 !important;
  border: 1px dashed #5cff5c !important;
  color: #5cff5c !important;
  font-family: "Courier New", "Lucida Console", Consolas, monospace !important;
}
input[type="checkbox"], input[type="radio"] {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 3ch !important;
  height: 1.3em !important;
  border: 0 !important;
  background: transparent !important;
  display: inline-grid !important;
  place-items: center !important;
  vertical-align: middle !important;
}
input[type="checkbox"]::before,
input[type="radio"]::before {
  content: "[ ]" !important;
  color: #5cff5c !important;
}
input[type="checkbox"]:checked::before,
input[type="radio"]:checked::before {
  content: "[X]" !important;
}
input[type="range"] {
  appearance: none !important;
  -webkit-appearance: none !important;
  background: transparent !important;
  border: 0 !important;
}
input[type="range"]::-webkit-slider-runnable-track {
  height: 1em !important;
  border-top: 1px dashed #5cff5c !important;
  background: repeating-linear-gradient(90deg, #5cff5c 0 1px, transparent 1px 1ch) !important;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none !important;
  width: 1ch !important;
  height: 1.4em !important;
  margin-top: -.2em !important;
  background: #5cff5c !important;
  border: 0 !important;
}
input[type="range"]::-moz-range-track {
  height: 1em !important;
  border-top: 1px dashed #5cff5c !important;
  background: transparent !important;
}
input[type="range"]::-moz-range-thumb {
  width: 1ch !important;
  height: 1.4em !important;
  background: #5cff5c !important;
  border: 0 !important;
}
pre, code, kbd, samp {
  background: #002000 !important;
  border: 1px dashed #5cff5c !important;
  color: #9cff9c !important;
}
img, video, canvas {
  filter: sepia(1) hue-rotate(55deg) saturate(1.6) contrast(1.05) !important;
  border: 1px dashed #5cff5c !important;
}
::selection {
  background: #5cff5c !important;
  color: #001400 !important;
}
`
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

  /* ── 核心启动逻辑 ── */
  function applySettings(settings) {
    removeInjected();
    if (isSiteDisabled(settings)) {
      clearVideoPauseGuard();
      return;
    }

    if (settings.pauseVideosEnabled) startVideoPauseGuard();
    else clearVideoPauseGuard();

    if (!settings.enabled) return;

    const css = buildCSS(settings);
    if (css.trim()) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      injectToRoot(style);
    }

    (settings.cssLibraries || []).filter(l => l.enabled).forEach(lib => loadLibrary(lib));

    const retroActive = (settings.cssLibraries || []).some(l => l.enabled && l.id === '98-css');
    const bgColor = settings.bgEnabled && settings.backgroundColor ? settings.backgroundColor
      : settings.darkMode === 'smartdark' ? '#1a1a1a'
      : retroActive ? '#bebebe'
      : null;
    if (bgColor) startBgJS(bgColor);
    if (settings.darkMode === 'dim') startDimJS(settings.dimAmount ?? 30);
  }

  function loadAndApply() {
    chrome.storage.sync.get(null, settings => {
      if (chrome.runtime.lastError) return;
      applySettings(settings);
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
