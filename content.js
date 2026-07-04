(function () {
  'use strict';
  if (window.__kboostRunning) return;
  window.__kboostRunning = true;

  const KEY = '__kboost';

  // Quality presets — dpr: 0 = native, >0 = fixed override
  const QUALITY_MAP = {
    potato: { dpr: 0.5,  antialias: false },
    low:    { dpr: 0.75, antialias: false },
    normal: { dpr: 1.0,  antialias: true  },
    high:   { dpr: 0,    antialias: true  },
  };

  // ── Defaults ──────────────────────────────────────────────────────────────────
  let cfg = {
    dpr: 1, fps: 30, ctxGuard: false,
    flashFix: true, antialias: true, filter: 'normal',
    quality: 'normal', zoom: 1.0,
    bgThrottle: true, bgFps: 5,
    hud: false,
    sessionStats: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    cfg = { ...cfg, ...saved };
    if (cfg.quality && QUALITY_MAP[cfg.quality]) {
      Object.assign(cfg, QUALITY_MAP[cfg.quality]);
    }
  } catch (_) {}

  // ════════════════════════════════════════════════════════════════════════════
  // 1. FLASH FIX
  // ════════════════════════════════════════════════════════════════════════════
  function applyFlashFix(enable) {
    const ID = 'kboost-flashfix';
    let el = document.getElementById(ID);
    if (enable) {
      if (!el) {
        el = document.createElement('style');
        el.id = ID;
        el.textContent = `
          html, body { background-color: #0a1628 !important; }
          .kn-fullbg  { background-color: #0a1628 !important; }
        `;
        (document.head || document.documentElement).prepend(el);
      }
    } else {
      if (el) el.remove();
    }
  }
  applyFlashFix(cfg.flashFix);

  // ════════════════════════════════════════════════════════════════════════════
  // 2. VISUAL FILTER
  // ════════════════════════════════════════════════════════════════════════════
  const FILTERS = {
    normal: '',
    vivid:  'saturate(1.45) contrast(1.08)',
    warm:   'sepia(0.28) saturate(1.2) hue-rotate(-8deg)',
    cool:   'hue-rotate(18deg) saturate(1.15) brightness(1.04)',
    night:  'brightness(0.72) saturate(0.85) hue-rotate(5deg)',
  };

  function applyFilter(preset) {
    const ID = 'kboost-filter';
    let el = document.getElementById(ID);
    const val = FILTERS[preset] || '';
    if (!val) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('style');
      el.id = ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = `html { filter: ${val}; }`;
  }
  applyFilter(cfg.filter);

  // ════════════════════════════════════════════════════════════════════════════
  // 3. ZOOM
  // ════════════════════════════════════════════════════════════════════════════
  function applyZoom(zoom) {
    const ID = 'kboost-zoom';
    let el = document.getElementById(ID);
    const z = Math.round(Math.max(0.5, Math.min(2.0, zoom || 1.0)) * 100) / 100;
    if (z === 1) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('style');
      el.id = ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = `html { zoom: ${z}; }`;
  }
  applyZoom(cfg.zoom);

  // ════════════════════════════════════════════════════════════════════════════
  // 4. DPR LOCK
  // ════════════════════════════════════════════════════════════════════════════
  if (cfg.dpr > 0) {
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => cfg.dpr,
        configurable: true,
      });
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5. FPS CAP  (shared rAF wrapper — also used by BG Throttle below)
  // ════════════════════════════════════════════════════════════════════════════
  const _origRAF = window.requestAnimationFrame;
  const _origCAF = window.cancelAnimationFrame;
  let _frameMs   = cfg.fps > 0 ? 1000 / cfg.fps : 0;
  let _rafLast   = 0;
  const _pending = new Map();
  let _seq = 800000;

  // _bgMode: when true we override _frameMs to bg throttle cap
  let _bgMode    = false;
  let _bgFrameMs = cfg.bgFps > 0 ? 1000 / cfg.bgFps : 200; // default 5fps

  function _effectiveFrameMs() {
    if (_bgMode && cfg.bgThrottle) return _bgFrameMs;
    return _frameMs;
  }

  window.requestAnimationFrame = function (cb) {
    const efms = _effectiveFrameMs();
    if (efms <= 0) return _origRAF.call(window, cb);
    const id   = ++_seq;
    const now  = performance.now();
    const wait = Math.max(0, efms - (now - _rafLast) - 1);
    const tid  = setTimeout(() => {
      if (!_pending.has(id)) return;
      _pending.delete(id);
      _origRAF.call(window, ts => { _rafLast = ts; cb(ts); });
    }, wait);
    _pending.set(id, tid);
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    const tid = _pending.get(id);
    if (tid != null) { clearTimeout(tid); _pending.delete(id); }
    else _origCAF.call(window, id);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 6. BACKGROUND TAB THROTTLE
  // ════════════════════════════════════════════════════════════════════════════
  // Uses the Page Visibility API — fires when user alt-tabs or minimises the
  // window. This is a READ-ONLY browser API; it does not send any data and
  // is completely safe from any game anti-cheat system.
  function _onVisibilityChange() {
    const hidden = document.hidden || document.visibilityState === 'hidden';
    _bgMode = hidden;
    // Notify HUD if running
    if (window.__kboostHudUpdate) window.__kboostHudUpdate();
  }

  if (cfg.bgThrottle) {
    document.addEventListener('visibilitychange', _onVisibilityChange);
    _onVisibilityChange(); // apply immediately in case page loads in bg tab
  }

  function _toggleBgThrottle(enable) {
    cfg.bgThrottle = enable;
    if (enable) {
      document.addEventListener('visibilitychange', _onVisibilityChange);
      _onVisibilityChange();
    } else {
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      _bgMode = false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 7. WEBGL CONTEXT GUARD
  // ════════════════════════════════════════════════════════════════════════════
  const _CTX_LIMIT  = 3;
  const _glContexts = [];

  function _glLoseCtx(ctx) {
    try { const ext = ctx.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) {}
  }

  (function () {
    const _origGetCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      if (!cfg.antialias && opts && (type === 'webgl' || type === 'webgl2')) {
        opts = { ...opts, antialias: false };
      }
      const ctx = _origGetCtx.call(this, type, opts);
      if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
        _glContexts.push(ctx);
        if (cfg.ctxGuard && _glContexts.length > _CTX_LIMIT) {
          const old = _glContexts.shift();
          setTimeout(() => _glLoseCtx(old), 300);
        }
      }
      return ctx;
    };
  })();

  // ════════════════════════════════════════════════════════════════════════════
  // 8. HUD OVERLAY  (FPS counter + Ping)
  // ════════════════════════════════════════════════════════════════════════════
  // Injected as a fixed <div> — purely reads timing data already available in
  // the page (performance.now, RAF callbacks). Does NOT read game state,
  // memory, or any protected resource. Zero ban risk.
  let _hudEl     = null;
  let _hudFrames = 0;
  let _hudFpsVal = 0;
  let _hudPingMs = 0;
  let _hudRafId  = null;
  let _hudLast   = performance.now();
  let _hudTick   = 0; // counter to update DOM ~4× per second

  // WebSocket ping measurement — hooks into existing WS traffic passively.
  // We only read timestamps of messages; we never send extra traffic.
  (function () {
    const _OrigWS = window.WebSocket;
    window.WebSocket = function (url, proto) {
      const ws = proto ? new _OrigWS(url, proto) : new _OrigWS(url);
      let _sent = 0;
      const _origSend = ws.send.bind(ws);
      ws.send = function (data) {
        _sent = performance.now();
        return _origSend(data);
      };
      ws.addEventListener('message', () => {
        if (_sent > 0) {
          const rtt = performance.now() - _sent;
          // Exponential moving average — smooth out jitter
          _hudPingMs = _hudPingMs === 0 ? rtt : _hudPingMs * 0.8 + rtt * 0.2;
          _sent = 0;
        }
      });
      return ws;
    };
    // Copy static props (CONNECTING, OPEN, etc.)
    Object.assign(window.WebSocket, _OrigWS);
    window.WebSocket.prototype = _OrigWS.prototype;
  })();

  function _hudLoop(ts) {
    _hudFrames++;
    const now  = ts || performance.now();
    const diff = now - _hudLast;
    _hudTick++;

    if (diff >= 500) { // update every 500ms
      _hudFpsVal = Math.round((_hudFrames / diff) * 1000);
      _hudFrames = 0;
      _hudLast   = now;
      _hudTick   = 0;
      if (_hudEl) {
        const bgColor  = _bgMode ? 'rgba(255,100,50,.85)' : 'rgba(0,0,0,.6)';
        const fpsColor = _hudFpsVal < 20 ? '#ff6b6b' : _hudFpsVal < 40 ? '#ffa94d' : '#30d158';
        const pingColor = _hudPingMs > 200 ? '#ff6b6b' : _hudPingMs > 100 ? '#ffa94d' : '#74c0fc';
        const bgLabel  = _bgMode ? '<span style="color:#ffcc00;font-weight:700"> BG</span>' : '';
        const pingStr  = _hudPingMs > 0 ? `<span style="color:${pingColor}">${Math.round(_hudPingMs)}</span><span class="kbhud-unit">ms</span>` : '<span class="kbhud-unit">—</span>';
        _hudEl.innerHTML =
          `<span style="color:${fpsColor}">${_hudFpsVal}</span><span class="kbhud-unit">fps</span>` +
          ` <span class="kbhud-sep">|</span> ${pingStr}${bgLabel}`;
        _hudEl.style.background = bgColor;
      }
    }

    if (cfg.hud && _hudEl) {
      _hudRafId = _origRAF.call(window, _hudLoop);
    } else {
      _hudRafId = null;
    }
  }

  // Expose for visibility-change callback above
  window.__kboostHudUpdate = function () {
    if (_hudEl && _bgMode) {
      _hudEl.style.background = 'rgba(255,100,50,.85)';
    }
  };

  function _createHud() {
    if (_hudEl) return;
    _hudEl = document.createElement('div');
    _hudEl.id = 'kboost-hud';
    _hudEl.style.cssText = [
      'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
      'background:rgba(0,0,0,.6)', 'color:#fff',
      'font:700 12px/1 "SF Mono",Menlo,Consolas,monospace',
      'padding:5px 8px', 'border-radius:6px',
      'pointer-events:none', 'user-select:none',
      'letter-spacing:.02em', 'white-space:nowrap',
      'backdrop-filter:blur(4px)',
      'border:1px solid rgba(255,255,255,.12)',
      'transition:background .4s ease',
    ].join(';');

    // Inline style for sub-elements (no external stylesheet needed)
    const style = document.createElement('style');
    style.id = 'kboost-hud-style';
    style.textContent = `
      #kboost-hud .kbhud-unit { font-size:10px; color:rgba(255,255,255,.55); margin-left:1px; }
      #kboost-hud .kbhud-sep  { color:rgba(255,255,255,.25); margin:0 3px; }
    `;
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.appendChild(_hudEl);

    _hudFrames = 0;
    _hudLast   = performance.now();
    _hudRafId  = _origRAF.call(window, _hudLoop);
  }

  function _destroyHud() {
    if (_hudRafId) { _origCAF.call(window, _hudRafId); _hudRafId = null; }
    if (_hudEl) { _hudEl.remove(); _hudEl = null; }
    const s = document.getElementById('kboost-hud-style');
    if (s) s.remove();
  }

  function _toggleHud(enable) {
    cfg.hud = enable;
    if (enable) {
      // Wait for body to exist (document_start fires before <body>)
      if (document.body) {
        _createHud();
      } else {
        document.addEventListener('DOMContentLoaded', _createHud, { once: true });
      }
    } else {
      _destroyHud();
    }
  }

  if (cfg.hud) _toggleHud(true);

  // ════════════════════════════════════════════════════════════════════════════
  // 9. SESSION STATS
  // ════════════════════════════════════════════════════════════════════════════
  // Tracks: session start time, total active time (tab visible), frames drawn.
  // Persisted to localStorage so stats survive popup open/close.
  // Never contacts any external server — all local.
  const STATS_KEY   = '__kboost_stats';
  const _sessionStart = performance.now();
  let   _statsActive  = !document.hidden; // track visibility for active time
  let   _statsActiveMs = 0;
  let   _statsLastActive = _statsActive ? performance.now() : 0;
  let   _statsFrames  = 0; // frames drawn this session (incremented in rAF)

  function _saveStats() {
    if (!cfg.sessionStats) return;
    try {
      const prev   = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
      const nowMs  = performance.now();
      if (_statsActive) _statsActiveMs += nowMs - _statsLastActive;
      _statsLastActive = nowMs;
      const today  = new Date().toISOString().slice(0, 10);

      const stats  = {
        totalSessionMs:  (prev.totalSessionMs  || 0) + (performance.now() - _sessionStart),
        totalActiveMs:   (prev.totalActiveMs   || 0) + _statsActiveMs,
        totalFrames:     (prev.totalFrames     || 0) + _statsFrames,
        sessionsToday:   prev.lastDate === today ? (prev.sessionsToday || 0) + 1 : 1,
        lastDate:        today,
        lastSaved:       Date.now(),
      };
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (_) {}
  }

  function _readStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch (_) { return {}; }
  }

  // Track active/idle via visibility
  document.addEventListener('visibilitychange', () => {
    const nowMs = performance.now();
    if (_statsActive) _statsActiveMs += nowMs - _statsLastActive;
    _statsActive = !document.hidden;
    _statsLastActive = nowMs;
    _saveStats();
  });

  // Count frames — piggyback on rAF but use ORIG to not affect game loop timing
  (function _statsTick() {
    _statsFrames++;
    if (cfg.sessionStats) _origRAF.call(window, _statsTick);
  })();

  // Save every 30s and on page unload
  setInterval(() => { if (cfg.sessionStats) _saveStats(); }, 30000);
  window.addEventListener('beforeunload', _saveStats);

  // Expose for popup to call via scripting.executeScript
  window.__kboostReadStats = function () {
    _saveStats();
    const s = _readStats();
    const nowMs = performance.now();
    const sessionActiveMs = _statsActive
      ? _statsActiveMs + (nowMs - _statsLastActive)
      : _statsActiveMs;
    return {
      totalActiveMs:  (s.totalActiveMs  || 0) + sessionActiveMs,
      totalFrames:    (s.totalFrames    || 0) + _statsFrames,
      sessionsToday:  s.sessionsToday   || 1,
      lastDate:       s.lastDate        || '',
    };
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 10. LIVE UPDATES FROM POPUP
  // ════════════════════════════════════════════════════════════════════════════
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    try {
      const next = JSON.parse(e.newValue || '{}');

      if (typeof next.fps        === 'number')  _frameMs = next.fps > 0 ? 1000 / next.fps : 0;
      if (typeof next.bgFps      === 'number')  _bgFrameMs = next.bgFps > 0 ? 1000 / next.bgFps : 200;
      if (typeof next.bgThrottle === 'boolean') _toggleBgThrottle(next.bgThrottle);
      if (typeof next.hud        === 'boolean') _toggleHud(next.hud);
      if (typeof next.flashFix   === 'boolean') { cfg.flashFix = next.flashFix; applyFlashFix(cfg.flashFix); }
      if (typeof next.filter     === 'string')  { cfg.filter   = next.filter;   applyFilter(cfg.filter);    }
      if (typeof next.zoom       === 'number')  { cfg.zoom     = next.zoom;     applyZoom(cfg.zoom);        }
      if (typeof next.sessionStats === 'boolean') cfg.sessionStats = next.sessionStats;

      if (typeof next.ctxGuard === 'boolean') {
        cfg.ctxGuard = next.ctxGuard;
        if (cfg.ctxGuard) {
          while (_glContexts.length > _CTX_LIMIT) {
            const old = _glContexts.shift(); setTimeout(() => _glLoseCtx(old), 300);
          }
        }
      }
      // quality/dpr/antialias: next page load
    } catch (_) {}
  });

  console.log(
    `%c[KBoost v1.1] Quality:${cfg.quality} FPS:${cfg.fps||'∞'} BgThrottle:${cfg.bgThrottle?'on':'off'} HUD:${cfg.hud?'on':'off'} SessionStats:${cfg.sessionStats?'on':'off'}`,
    'color:#0a84ff;font-weight:700;font-size:12px'
  );
})();
