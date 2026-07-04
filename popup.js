'use strict';

const KEY       = '__kboost';
const STATS_KEY = '__kboost_stats';
const SOL_ADDR  = '5SfFWF7KanhecVNVo1pzFLm9gb8oWE2NZzsxWRG38iUk';

const DEFAULTS = {
  fps: 30, ctxGuard: false,
  flashFix: true, filter: 'normal',
  quality: 'normal', zoom: 1.0,
  bgThrottle: true, bgFps: 5,
  hud: false,
  sessionStats: true,
};

const QUALITY_MAP = {
  potato: { label: 'Potato — DPR 0.5× · AA off · lightest',  dprLabel: '0.5×' },
  low:    { label: 'Low — DPR 0.75× · AA off · lighter',     dprLabel: '0.75×' },
  normal: { label: 'Normal — DPR 1× · AA on · balanced',     dprLabel: '1.0×' },
  high:   { label: 'High — Native DPR · AA on · best visuals', dprLabel: 'Native' },
};

const FPS_LABELS = {
  20: 'Low (20 fps)',
  30: 'Balanced (30 fps)',
  45: 'Smooth (45 fps)',
  60: 'Extra Smooth (60 fps)',
  0:  'Max (uncapped)',
};

const FILTER_HINTS = {
  normal: 'Normal — no filter applied',
  vivid:  'Vivid — higher saturation & contrast',
  warm:   'Warm — sepia / warm tone',
  cool:   'Cool — blue-shifted tone',
  night:  'Night — dimmed for dark rooms',
};

const ZOOM_STEP = 0.1;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
function isKintaraTab(tab) {
  return !!(tab?.url && /kintara\.(gg|com)/i.test(tab.url));
}
async function loadCfg() {
  const data = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...(data[KEY] || {}) };
}
async function saveCfg(cfg, tab) {
  await chrome.storage.local.set({ [KEY]: cfg });
  if (tab?.id && isKintaraTab(tab)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (key, val) => {
        localStorage.setItem(key, val);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: val }));
      },
      args: [KEY, JSON.stringify(cfg)],
    }).catch(() => {});
  }
}

// ── GPU relief estimate ────────────────────────────────────────────────────────
function gpuRelief(cfg) {
  // pixel area factor relative to native DPR 2 screen
  const pf = { potato: 0.0625, low: 0.1406, normal: 0.25, high: 1.0 }[cfg.quality] ?? 0.25;
  const fpsCap = cfg.fps > 0 ? Math.min(cfg.fps, 60) : 60;
  return `↓${Math.round((1 - pf * fpsCap / 60) * 100)}%`;
}

// ── Impact stats panel ─────────────────────────────────────────────────────────
function updateImpact(cfg) {
  const q = QUALITY_MAP[cfg.quality] || QUALITY_MAP.normal;
  document.getElementById('statDPR').textContent = q.dprLabel;
  document.getElementById('statFPS').textContent = cfg.fps > 0 ? String(cfg.fps) : '∞';
  document.getElementById('statGPU').textContent = gpuRelief(cfg);
  const boosted = (cfg.quality === 'potato' || cfg.quality === 'low') && cfg.fps > 0 && cfg.fps <= 45;
  const color   = boosted ? 'var(--green)' : 'var(--accent)';
  document.querySelectorAll('.stat-num').forEach(el => el.style.color = color);
}

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function clampZoom(z) {
  return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
}
function zoomLabel(z) {
  if (z === 1.0) return 'Normal (1.0×)';
  return z < 1.0
    ? `Zoomed out — ${Math.round(z * 100)}% (see more map)`
    : `Zoomed in — ${Math.round(z * 100)}% (larger view)`;
}

// ── Session stats helpers ─────────────────────────────────────────────────────
function fmtMs(ms) {
  if (!ms || ms < 1000) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function fmtFrames(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

async function refreshSessionStats(tab) {
  const gridEl = document.getElementById('sstatGrid');
  if (!gridEl) return;

  // Try to read live stats from the page context first
  let stats = null;
  if (tab?.id && isKintaraTab(tab)) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => typeof window.__kboostReadStats === 'function'
          ? window.__kboostReadStats()
          : null,
      });
      stats = result?.result || null;
    } catch (_) {}
  }

  // Fallback: read from extension storage
  if (!stats) {
    const data = await chrome.storage.local.get(STATS_KEY);
    stats = data[STATS_KEY] || null;
  }

  if (!stats) {
    document.getElementById('sstatTime').textContent     = '—';
    document.getElementById('sstatSessions').textContent = '—';
    document.getElementById('sstatFrames').textContent   = '—';
    return;
  }

  document.getElementById('sstatTime').textContent     = fmtMs(stats.totalActiveMs);
  document.getElementById('sstatSessions').textContent = String(stats.sessionsToday || 1);
  document.getElementById('sstatFrames').textContent   = fmtFrames(stats.totalFrames);
}

// ── Tooltip system ────────────────────────────────────────────────────────────
function initTooltips() {
  const bubble = document.getElementById('tooltipBubble');
  if (!bubble) return;
  let activeBtn = null;

  document.querySelectorAll('.tt').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      activeBtn = btn;
      bubble.textContent = btn.dataset.tip || '';
      bubble.hidden = false;
      const r  = btn.getBoundingClientRect();
      const br = document.body.getBoundingClientRect();
      // Position above the ? button, centred
      const left = Math.max(8, Math.min(
        r.left - br.left + r.width / 2 - bubble.offsetWidth / 2,
        br.width - bubble.offsetWidth - 8
      ));
      bubble.style.left = left + 'px';
      // Try above first, flip below if not enough space
      const topAbove = r.top - br.top - bubble.offsetHeight - 6;
      bubble.style.top = (topAbove < 4 ? r.bottom - br.top + 6 : topAbove) + 'px';
    });
    btn.addEventListener('mouseleave', () => {
      if (activeBtn === btn) { bubble.hidden = true; activeBtn = null; }
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const showing = !bubble.hidden && activeBtn === btn;
      bubble.hidden = showing;
      if (!showing) {
        activeBtn = btn;
        bubble.textContent = btn.dataset.tip || '';
        bubble.hidden = false;
        const r  = btn.getBoundingClientRect();
        const br = document.body.getBoundingClientRect();
        const left = Math.max(8, Math.min(
          r.left - br.left + r.width / 2 - bubble.offsetWidth / 2,
          br.width - bubble.offsetWidth - 8
        ));
        bubble.style.left = left + 'px';
        const topAbove = r.top - br.top - bubble.offsetHeight - 6;
        bubble.style.top = (topAbove < 4 ? r.bottom - br.top + 6 : topAbove) + 'px';
      }
    });
  });
  document.addEventListener('click', () => { bubble.hidden = true; activeBtn = null; });
}

// ── Copy wallet ────────────────────────────────────────────────────────────────
function initDonate() {
  const btn = document.getElementById('copyBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(SOL_ADDR); } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = SOL_ADDR; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    btn.querySelector('.copy-icon').style.display  = 'none';
    btn.querySelector('.check-icon').style.display = '';
    btn.querySelector('.copy-label').textContent   = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.querySelector('.copy-icon').style.display  = '';
      btn.querySelector('.check-icon').style.display = 'none';
      btn.querySelector('.copy-label').textContent   = 'Copy';
      btn.classList.remove('copied');
    }, 2200);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const tab       = await getActiveTab();
  const onKintara = isKintaraTab(tab);

  // Status badge
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (onKintara) { dot.classList.add('on');  label.textContent = 'Active'; }
  else           { dot.classList.add('off'); label.textContent = 'Not on Kintara'; }

  const cfg = await loadCfg();

  // ── Frame Limit ─────────────────────────────────────────────────────────────
  const fpsHint = document.getElementById('fpsHint');
  function selectFps(fps) {
    document.querySelectorAll('.fps-btn').forEach(b =>
      b.classList.toggle('active', (parseInt(b.dataset.fps) || 0) === fps)
    );
    fpsHint.textContent = FPS_LABELS[fps] ?? `${fps} fps`;
  }
  selectFps(cfg.fps);
  document.querySelectorAll('.fps-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      cfg.fps = parseInt(btn.dataset.fps) || 0;
      selectFps(cfg.fps);
      await saveCfg(cfg, tab);
      updateImpact(cfg);
    });
  });

  // ── Background Throttle ──────────────────────────────────────────────────────
  const bgThrottleToggle = document.getElementById('bgThrottleToggle');
  bgThrottleToggle.checked = cfg.bgThrottle;
  bgThrottleToggle.addEventListener('change', async () => {
    cfg.bgThrottle = bgThrottleToggle.checked;
    await saveCfg(cfg, tab);
    // Live — content.js reacts via storage event
  });

  // ── Context Guard ────────────────────────────────────────────────────────────
  const ctxGuardToggle = document.getElementById('ctxGuardToggle');
  ctxGuardToggle.checked = cfg.ctxGuard;
  ctxGuardToggle.addEventListener('change', async () => {
    cfg.ctxGuard = ctxGuardToggle.checked;
    await saveCfg(cfg, tab);
    updateImpact(cfg);
  });

  // ── Graphics Quality ─────────────────────────────────────────────────────────
  const qualityHint = document.getElementById('qualityHint');
  const TIER_COLOR  = { potato: '#ff6b6b', low: '#ffa94d', normal: null, high: '#74c0fc' };
  function selectQuality(q) {
    document.querySelectorAll('.quality-btn').forEach(b => {
      const active = b.dataset.quality === q;
      b.classList.toggle('active', active);
      b.style.color = active && TIER_COLOR[q] ? TIER_COLOR[q] : '';
    });
    qualityHint.textContent = QUALITY_MAP[q]?.label ?? q;
  }
  selectQuality(cfg.quality);
  document.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      cfg.quality = btn.dataset.quality;
      selectQuality(cfg.quality);
      await saveCfg(cfg, tab);
      updateImpact(cfg);
      if (onKintara) document.getElementById('reloadNotice').hidden = false;
    });
  });

  // ── Camera Zoom ──────────────────────────────────────────────────────────────
  const zoomHint = document.getElementById('zoomHint');
  const zoomBar  = document.getElementById('zoomBar');
  function renderZoom(z) {
    zoomHint.textContent = zoomLabel(z);
    const pct = ((z - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;
    zoomBar.style.width = pct + '%';
    document.querySelectorAll('.zoom-preset').forEach(b =>
      b.classList.toggle('active', parseFloat(b.dataset.zoom) === z)
    );
    document.getElementById('zoomOut').style.opacity = z <= ZOOM_MIN ? '0.3' : '';
    document.getElementById('zoomIn').style.opacity  = z >= ZOOM_MAX ? '0.3' : '';
  }
  async function setZoom(z) {
    cfg.zoom = clampZoom(z);
    renderZoom(cfg.zoom);
    await saveCfg(cfg, tab);
  }
  renderZoom(cfg.zoom);
  document.getElementById('zoomIn').addEventListener('click',    () => setZoom(cfg.zoom + ZOOM_STEP));
  document.getElementById('zoomOut').addEventListener('click',   () => setZoom(cfg.zoom - ZOOM_STEP));
  document.getElementById('zoomReset').addEventListener('click', () => setZoom(1.0));
  document.querySelectorAll('.zoom-preset').forEach(btn =>
    btn.addEventListener('click', () => setZoom(parseFloat(btn.dataset.zoom)))
  );

  // ── Flash Fix ────────────────────────────────────────────────────────────────
  const flashFixToggle = document.getElementById('flashFixToggle');
  flashFixToggle.checked = cfg.flashFix;
  flashFixToggle.addEventListener('change', async () => {
    cfg.flashFix = flashFixToggle.checked;
    await saveCfg(cfg, tab);
  });

  // ── Visual Filter ────────────────────────────────────────────────────────────
  const filterHint = document.getElementById('filterHint');
  function selectFilter(preset) {
    document.querySelectorAll('.filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.filter === preset)
    );
    filterHint.textContent = FILTER_HINTS[preset] || preset;
  }
  selectFilter(cfg.filter);
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      cfg.filter = btn.dataset.filter;
      selectFilter(cfg.filter);
      await saveCfg(cfg, tab);
    });
  });

  // ── HUD Toggle ───────────────────────────────────────────────────────────────
  const hudToggle = document.getElementById('hudToggle');
  hudToggle.checked = cfg.hud;
  hudToggle.addEventListener('change', async () => {
    cfg.hud = hudToggle.checked;
    await saveCfg(cfg, tab);
    // Live — content.js reacts via storage event
  });

  // ── Session Stats Toggle ─────────────────────────────────────────────────────
  const sessionStatsToggle = document.getElementById('sessionStatsToggle');
  const sstatGrid = document.getElementById('sstatGrid');
  sessionStatsToggle.checked = cfg.sessionStats;
  sstatGrid.style.opacity = cfg.sessionStats ? '' : '0.35';

  sessionStatsToggle.addEventListener('change', async () => {
    cfg.sessionStats = sessionStatsToggle.checked;
    sstatGrid.style.opacity = cfg.sessionStats ? '' : '0.35';
    await saveCfg(cfg, tab);
  });

  // Load session stats into UI
  await refreshSessionStats(tab);

  // Reset button
  document.getElementById('sstatResetBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(STATS_KEY);
    if (tab?.id && isKintaraTab(tab)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => localStorage.removeItem('__kboost_stats'),
      }).catch(() => {});
    }
    document.getElementById('sstatTime').textContent     = '—';
    document.getElementById('sstatSessions').textContent = '—';
    document.getElementById('sstatFrames').textContent   = '—';
  });

  // ── Reload button ────────────────────────────────────────────────────────────
  document.getElementById('reloadBtn').addEventListener('click', () => {
    if (tab?.id) chrome.tabs.reload(tab.id);
    window.close();
  });

  // ── Donate ───────────────────────────────────────────────────────────────────
  initDonate();

  // ── Tooltips ─────────────────────────────────────────────────────────────────
  initTooltips();

  // ── Initial render ────────────────────────────────────────────────────────────
  updateImpact(cfg);
}

init().catch(err => console.error('[KBoost]', err));
