/* loop-yr — main script
   Photos on a twelve-month ring, one ring per year. Scroll turns the ring; one turn is one year.
   v2: each day carries its own weight, from how many photos it holds (the more photos, the more attention).
   The year is a ring of photo lines: every photo a thin line through its middle, a day's photos sharing its arc, so busy
   days read as dense runs of streaks. Stacks (key S, opt-in) grows each day's photos outward as a compiled library
   column, first photo innermost, so busy days reach further. The light switch (key L) turns the ring into heat colours,
   one per day's weight, with no photos at all.

   Works two ways:
   - opened straight from the folder (file://): Chrome will not hand local images or videos to WebGL, so the
     photos are read from media-js/ (the same files wrapped as scripts) and turned into in-page blobs;
   - served from a web host (https://): the plain files in media/ are used.
   Load order (index.html): js/three.min.js, js/ingest.js, then this file. */
(function () {
  "use strict";

  // ---------- Tunables (the feel lives here; every visual value can be changed by hand) ----------
  const R = 900;               // ring radius, px
  const CARD_L = 170;          // base long edge of a photo lifted out of the library (the front or hovered photo), px
  const CORNER_PX = 10;        // rounded photo corners, in screen px on the photo at the front
  const SPEED_MAX = 14;        // speed (deg per frame) beyond which nothing grows further
  const PARALLAX = { yaw: 3, pitch: 2 };   // the view leans toward the pointer by up to this much (deg)
  const OVERVIEW_EXPANDED = { dist: 6600, tilt: -18, roll: -10 };
  const STAND_SCALE = 2.4;     // growth of the front photo (focus view)
  const OVERVIEW_SCALE = 1.5;  // growth of the front photo (Homescreen / overview)
  const HOVER_SCALE = 1.6;     // growth of a hovered photo
  const LEVEL = 0.85;          // how much of the camera roll a raised card cancels
  const INTRO_TOTAL = 6500;    // ms from the first scroll until the instructions are gone
  const INTRO_FADE = 900;      // ms the instructions take to fade out (matches #intro in style.css)
  const GAP_COLLAPSED = 150;   // px between piled year rings (each is a donut with body, so they need room)
  const GAP_EXPANDED = 620;    // px between year rings in the cylinder
  const VIEW = {
    focus:    { dist: 300,  tilt: -42, roll: -38, ox: -0.145, oy: 0.03 },   // 03 Spring / Winter Scroll
    overview: { dist: 2500, tilt: -28, roll: -44, ox: -0.07,  oy: 0.08 }    // 02 Homescreen
  };
  const VIEW_PHONE = {
    focus:    { dist: 480,  tilt: -42, roll: -38, ox: -0.02, oy: -0.08 },
    overview: { dist: 4300, tilt: -28, roll: -44, ox: 0.0,   oy: -0.04 }
  };
  const SMOOTH = 0.075;        // per-frame easing (lower = slower, dreamier)
  const VIGNETTE = 0.9;        // how far the screen edges fade into the stage (0 = none, 1 = fully)
  const EDGE_BLUR = 0.012;     // streak length at the screen edge while the ring is still (fraction of the screen)
  const MOTION_BLUR = 0.004;   // extra streak per degree the ring turns in a frame …
  const MOTION_BLUR_MAX = 0.05;  // … up to this much
  const WHEEL_DEG = 0.14;      // ring turn per px of wheel / two-finger scroll
  const TOUCH_DEG = 0.3;       // ring turn per px of one-finger swipe
  const FLING_MS = 220, FLING_MAX = 120;   // a flick carries on for about this much of its speed (ms), at most this many degrees
  const ZOOM_MIN = 0.5, ZOOM_MAX = 7;      // pinch / trackpad zoom range (zooming in goes toward the point under the fingers)
  const FRONT_FULL = 8;        // within this many degrees of the front a photo is fully raised
  const FRONT_EDGE = 24;       // beyond this it rests in the ring
  const SHADE = { current: 1, near: 0.92 };
  const PAST = { start: 0.35, step: 0.6, min: 0.06 };   // past years in black and white: brightness of the year below, × step per year further back

  // ---------- v2: attention (how many photos a day holds) ----------
  const DAY_START_HOUR = 4;    // a day runs 4:00 AM to 3:59 AM, so a concert that ends after midnight stays one night
  const WEIGHT_PCT = 0.95;     // the day count that maps to full weight: 95% of photographed days stay at or under it
  const WEIGHT_SMALL = 20;     // with fewer photographed days than this, the busiest day sets the scale instead
  const WEIGHT_ESTIMATED = 0.3;  // drawn weight for photos whose date was only estimated (they are not counted)

  // The library ring. Every photo is a flat tile lying on the ring. Each day is one column at its place in the year, and
  // its photos stack outward row by row, first photo innermost, so quiet stretches stay a thin band of slivers and busy
  // days push fragmented blocks outward. Inside the first row, the inner ring holds every photo again as a thin line.
  const CARD_GROW = { base: 0.8, range: 0.6 };   // lifted photo size = CARD_L × (base + range × w)
  const CARD_JITTER = 0.06;    // random size variation left (±), so weight, not chance, sets size
  const LIB = {
    base: R - 130,             // px from the centre to the inner edge of the first row
    row: 34,                   // px height of a row …
    rowGrow: 0.03,             // … each row out a little taller (× rank)
    gap: 4,                    // px between rows
    stackPow: 0.86,            // rows of a very full day pack a little closer (rank ^ stackPow)
    fill: 0.84,                // share of a day's arc a first-row tile covers (the rest is the gap between columns) …
    widen: 0.2,                // … each row out a tile widens by this share of the day's arc …
    maxSpan: 3,                // … up to this many days' arcs (outer fragments overlap their neighbours)
    band: 190,                 // px width of the inner ring, inside the first row: each photo a thin line through its middle …
    lineShade: 1,              // … kept at full brightness, so the ring of lines reads clearly from afar …
    bowl: 16,                  // deg the ring rises outward, like a shallow bowl, so it has depth as it turns
    heatLen: { min: 40, max: 560 },   // heat view: a photo's line runs this long, quiet … heavy day (px from the inner edge)
    lean: 17.5,                // deg the ring leans so winter sits higher than summer (half of the 35° it once could reach; below 0 would put summer higher)
    stackSmooth: 0.06,         // easing of Stacks growing out of the ring and back
    view: { tilt: -54, roll: -14, oy: -0.04, dist: 2500 }   // overview camera: looking down across the bowl, steep enough that the far side of the year is not squashed
  };
  const SHADE_W = { quiet: 0.55, heavy: 1.0 };   // selected-year brightness from a quiet to a heavy day
  const PAST_W = { base: 0.6, range: 0.4 };      // past-year brightness × (base + range × w): held days stay lit

  const HEAT_RAMP = ["#FEF1C9", "#EE8A4C", "#72A7EF", "#F7C2F5", "#FEF98D"];   // the inner ring's heat colours, quiet → heavy
  // Heat colour measures a day from a single photo (0) up to a full-weight day (1). With the weight formula alone, a
  // one-photo day already sits at 0.3, so the quiet end of the ramp would never show.
  const HEAT_FROM_ONE = true;
  const TICKS = { r: 470, len: 40, alpha: 0.4, width: 1.4, circle: 0.14 };   // month ticks inside the ring, px, on a faint calendar circle
  const LABELS = { season: 1500, month: 425, minScale: 0.6, maxScale: 1.8 };   // px from the centre; text keeps one size, nearer labels a little larger and farther ones smaller (within these)   // px from the centre: season labels outside the ring, month labels inside the ticks
  const MONTH_LABEL_ZOOM = 1.35;   // month names show in focus view, or once zoomed in past this
  const SWITCH_SMOOTH = 0.05;  // easing of the light switch (the inner ring between photo lines and heat colours)
  const DIVE = { height: 0.5, blur: 0.022 };     // clicked photo: grows to this share of the screen height; the rest blurs this much
  const THEME = { light: { bg: "#FEFAEE", fg: "#000000" }, dark: { bg: "#000000", fg: "#FFFFFF" } };
  const SEASONS = [   // one fixed order with the calendar; mid = where the label sits (day of the year)
    { name: "Winter", mid: 14, months: [11, 0, 1] }, { name: "Spring", mid: 105, months: [2, 3, 4] },
    { name: "Summer", mid: 197, months: [5, 6, 7] }, { name: "Fall", mid: 288, months: [8, 9, 10] }
  ];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const lerp = (a, b, t) => a + (b - a) * t;
  const D = Math.PI / 180;
  const isPhone = () => innerWidth < 760;
  const view = (mode) => (isPhone() ? VIEW_PHONE : VIEW)[mode];
  const worldScale = () => isPhone() ? Math.max(0.5, innerWidth / 650) : Math.min(1, innerWidth / 1500);
  const perspective = () => isPhone() ? 1100 : 1500;

  // =====================================================================================================
  // Opening → instructions → ring
  // Wired up first, before the photo list or the 3D library are touched, so the opening always answers.
  // The opening animation itself is pure CSS (style.css, "01 Opening").
  // =====================================================================================================
  const landing = $("#landing"), intro = $("#intro"), statusEl = $("#status");
  const choose = $("#choose"), chStatus = $("#chStatus"), chTitle = $("#chTitle");
  if (matchMedia("(hover: none) and (pointer: coarse)").matches) chTitle.textContent = "Add your photos";   // nothing to drop on a phone
  const chTitleCopy = chTitle.textContent;
  let phase = "landing";       // landing → choose (→ reading) → intro → live; "help" while the instructions are replayed
  let introTimer = 0, ring = null, failed = "";

  // Theme: light (cream) or dark (black), following the system until the visitor flips it
  const root = document.documentElement, darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches;
  function themeChanged() {
    const dark = isDark();
    $('meta[name="theme-color"]').setAttribute("content", (dark ? THEME.dark : THEME.light).bg);
    $("#btnTheme").setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
    if (ring) ring.setTheme(dark);
  }
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", themeChanged);
  $("#btnTheme").addEventListener("click", () => { root.dataset.theme = isDark() ? "light" : "dark"; themeChanged(); });
  themeChanged();

  // The instructions rise line by line, so the paragraph is re-set as one block per line as the browser wraps it.
  const introText = $("#introText"), introCopy = introText.textContent;
  function setIntroLines(text) {
    introText.textContent = "";
    const words = text.split(/\s+/).map((w) => {
      const s = document.createElement("span"); s.textContent = w;
      introText.append(s, " "); return s;
    });
    const lines = [];
    words.forEach((s) => { const top = s.offsetTop; if (!lines.length || lines[lines.length - 1].top !== top) lines.push({ top, words: [] }); lines[lines.length - 1].words.push(s.textContent); });
    introText.textContent = "";
    lines.forEach((l, i) => { const s = document.createElement("span"); s.className = "ln"; s.style.setProperty("--i", i); s.textContent = l.words.join(" "); introText.append(s); });
  }
  function showIntro(over) {
    intro.classList.toggle("over", over);
    intro.classList.add("show");                   // visible before measuring, so the lines break as they will be seen
    setIntroLines(failed || introCopy);
  }

  function start() {                               // first scroll on the opening: asks for photos
    if (phase !== "landing") return;
    phase = "choose";
    landing.classList.add("gone");
    choose.classList.add("show"); choose.removeAttribute("aria-hidden");
    $("#choosePhotos").focus({ preventScroll: true });
  }
  function useAlbum(album) {                       // photos chosen (or the example album): build the ring, then the instructions
    try { ring = buildRing(album) || null; }
    catch (e) { console.error(e); fail("Something went wrong while setting up the ring. Reload the page to try again."); }
    if (!ring) { phase = "choose"; choose.classList.remove("reading"); chStatus.textContent = failed; return; }
    phase = "intro";
    choose.classList.remove("show"); choose.setAttribute("aria-hidden", "true");
    showIntro(false);                              // instructions right away …
    introTimer = setTimeout(enter, INTRO_TOTAL - INTRO_FADE);   // … fading out so they are gone in time
  }
  function enter() {
    if (phase !== "intro") return;
    clearTimeout(introTimer);
    phase = "live";
    intro.classList.remove("show");
    $("#ui").classList.add("in");                  // header, year bar and controls rise in
    ring.enter();
  }
  function replayIntro() {
    if (phase !== "live") return;
    phase = "help";
    showIntro(true);
    introTimer = setTimeout(closeHelp, INTRO_TOTAL - INTRO_FADE);
  }
  function closeHelp() { if (phase !== "help") return; clearTimeout(introTimer); phase = "live"; intro.classList.remove("show"); }
  const skip = () => { if (phase === "intro") enter(); else if (phase === "help") closeHelp(); };
  function fail(msg) { failed = msg; statusEl.textContent = msg; }

  // ---------- Choosing photos: the picker, a folder, drag and drop anywhere, or the example album ----------
  const exampleAlbum = () => {
    const m = window.YL_MANIFEST;
    return { manifest: m, atlas: (ai) => Promise.resolve(m.atlas.files[ai]), sheet: (si) => Promise.resolve(m.sheet.files[si]), clip: (v) => videoURL(v) };
  };
  function setProgress(f, text) { choose.style.setProperty("--p", f.toFixed(4)); chStatus.textContent = text; }
  async function readOwn(fileList) {
    const files = [...(fileList || [])];
    if (phase !== "choose" || !files.length) return;
    if (!window.YL_INGEST) { chStatus.textContent = "The photo reader (js/ingest.js) did not load. Keep the js folder next to index.html."; return; }
    phase = "reading"; choose.classList.add("reading"); chTitle.textContent = chTitleCopy;
    setProgress(0, "Reading your photos");
    try {
      const album = await window.YL_INGEST.read(files, (stage, n, total) => setProgress(
        stage === "dates" ? 0.15 * n / total : 0.15 + 0.85 * n / total,
        (stage === "dates" ? "Reading dates" : "Placing photos") + ` · ${n} of ${total}`));
      phase = "choose"; useAlbum(album);
    } catch (e) {
      console.error(e);
      phase = "choose"; choose.classList.remove("reading"); setProgress(0, "");
      chStatus.textContent = e.message === "none" ? "None of those are photos or videos. Try JPEG, HEIC, PNG, MOV or MP4 files."
                                                  : "Those photos could not be read in this browser. Try exporting them as JPEG.";
    }
  }
  $("#choosePhotos").addEventListener("click", () => $("#pick").click());
  $("#chooseFolder").addEventListener("click", () => $("#pickFolder").click());
  ["#pick", "#pickFolder"].forEach((id) => $(id).addEventListener("change", (e) => { readOwn(e.target.files); e.target.value = ""; }));
  $("#example").addEventListener("click", () => { if (phase === "choose") useAlbum(exampleAlbum()); });
  if (!window.YL_MANIFEST || !window.YL_MANIFEST.items) $("#example").hidden = true;
  const dragOn = (on) => { choose.classList.toggle("drag", on); chTitle.textContent = on ? "Let go to add them" : chTitleCopy; };
  addEventListener("dragover", (e) => {
    if (phase !== "landing" && phase !== "choose") return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    if (phase === "landing") start();
    dragOn(true);
  });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) dragOn(false); });
  addEventListener("drop", async (e) => {
    e.preventDefault(); dragOn(false);
    if (phase !== "choose" || !window.YL_INGEST) return;
    readOwn(await window.YL_INGEST.filesFromDrop(e.dataTransfer));
  });

  // Local testing only: on localhost, ?album=<list.json> ({ files: [{ url, name }] }, made by tools/make-test-album.py)
  // fetches those files from the same local server and reads them exactly as the picker would, so a test album opens
  // without choosing files by hand. Nothing is sent anywhere.
  const albumList = new URLSearchParams(location.search).get("album");
  if (albumList && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) (async () => {
    start();
    try {
      const list = (await (await fetch(albumList)).json()).files, files = new Array(list.length);
      const get = async (url, tries) => {                // a stalled request is retried once, then skipped
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
        try { return await (await fetch(url, { signal: ctl.signal })).blob(); }
        catch (e) { return tries > 1 ? get(url, tries - 1) : null; }
        finally { clearTimeout(timer); }
      };
      let next = 0, n = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < list.length) {
          const k = next++, blob = await get(list[k].url, 2);
          if (blob) files[k] = new File([blob], list[k].name, { type: blob.type });
          setProgress(0, `Fetching the test album · ${++n} of ${list.length}`);
        }
      }));
      readOwn(files.filter(Boolean));
    } catch (e) { console.error(e); chStatus.textContent = "The test album could not be fetched."; }
  })();

  // Scroll, swipe, key or click on the opening starts. Trackpad momentum after that first scroll keeps
  // arriving for a second or two, so scrolling never skips the instructions; a click, tap or Esc does.
  addEventListener("wheel", (e) => {
    if (phase === "live") return;                  // the ring handles it
    e.preventDefault();
    if (phase === "landing" && Math.abs(e.deltaY) + Math.abs(e.deltaX) > 1) start();
  }, { passive: false });
  let swipeY = null;
  addEventListener("touchstart", (e) => { swipeY = phase === "landing" && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (phase !== "landing") return;
    e.preventDefault();
    if (swipeY !== null && Math.abs(e.touches[0].clientY - swipeY) > 8) start();
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (phase === "landing" && ["ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); start(); return; }
    if ((phase === "intro" || phase === "help") && !e.repeat && ["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); skip(); }   // the ring does not see this key
  });
  $("#start").addEventListener("click", start);
  intro.addEventListener("pointerdown", skip);
  $("#info").addEventListener("click", replayIntro);

  // =====================================================================================================
  // Media: plain files when hosted, script-wrapped copies when opened from the folder
  // =====================================================================================================
  const LOCAL = location.protocol === "file:";
  const pendingMedia = new Map();                  // path → { waiting: [resolve], script }
  window.YL_MEDIA = function (path, type, b64) {   // called by each media-js/… file
    const p = pendingMedia.get(path);
    if (!p) return;
    pendingMedia.delete(path); p.script.remove();
    const bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type });
    p.waiting.forEach((resolve) => resolve(URL.createObjectURL(blob)));
  };
  function mediaURL(path) {                        // → Promise of a URL WebGL may use (null if missing)
    if (!LOCAL) return Promise.resolve(path);
    return new Promise((resolve) => {
      const p = pendingMedia.get(path);
      if (p) { p.waiting.push(resolve); return; }
      const s = document.createElement("script");
      s.src = path.replace(/^media\//, "media-js/").replace(/\.[a-z0-9]+$/i, ".js");
      s.onerror = () => {
        const q = pendingMedia.get(path); pendingMedia.delete(path); s.remove();
        if (q) q.waiting.forEach((r) => r(null));
      };
      pendingMedia.set(path, { waiting: [resolve], script: s });
      document.head.appendChild(s);
    });
  }
  const freeURL = (url) => { if (LOCAL && url) URL.revokeObjectURL(url); };
  const videoURLs = new Map();                     // the short clips are kept once read
  const videoURL = (path) => { if (!videoURLs.has(path)) videoURLs.set(path, mediaURL(path)); return videoURLs.get(path); };

  // =====================================================================================================
  // The ring
  // =====================================================================================================
  function buildRing(album) {                      // album: { manifest, atlas(i), sheet(i), clip(key) }, each a Promise of a path or canvas
    const manifest = album.manifest;
    if (!window.THREE) return fail("The 3D library (js/three.min.js) did not load. Keep the js folder next to index.html.");
    if (!manifest || !manifest.items || !manifest.items.length) return fail("The photo list did not load. Keep the js folder next to index.html.");

    // ---------- Album ----------
    const YEARS = manifest.years;
    let seed = 20240908;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const parseLocal = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13) || 0, +s.slice(14, 16) || 0);
    const dayOfYear = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5);   // UTC: no daylight-saving slips
    const daysIn = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;

    // ---------- Attention: one weight per day, from its photo count against the album's own busy days ----------
    // w = min(1, ln(1 + n) / ln(1 + n95)); photos with an estimated date are not counted (an export can stamp hundreds
    // of files with one date) and are drawn at a neutral weight.
    const dates = manifest.items.map((it) => parseLocal(it.d));
    const dayKey = (d) => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() - DAY_START_HOUR, d.getMinutes());
                            return s.getFullYear() * 10000 + (s.getMonth() + 1) * 100 + s.getDate(); };
    const keys = dates.map(dayKey), counted = new Map(), held = new Map();
    manifest.items.forEach((it, i) => {
      held.set(keys[i], (held.get(keys[i]) || 0) + 1);
      if (!it.e) counted.set(keys[i], (counted.get(keys[i]) || 0) + 1);
    });
    const dayCounts = [...counted.values()].sort((a, b) => a - b);
    const nScale = !dayCounts.length ? 0 : dayCounts.length < WEIGHT_SMALL ? dayCounts[dayCounts.length - 1]
                 : dayCounts[Math.min(dayCounts.length - 1, Math.ceil(WEIGHT_PCT * dayCounts.length) - 1)];
    const weightOf = (n) => nScale > 0 ? Math.min(1, Math.log1p(n) / Math.log1p(nScale)) : 0;
    const wOne = HEAT_FROM_ONE && nScale > 1 ? weightOf(1) : 0;
    const heatOf = (w) => Math.max(0, (w - wOne) / (1 - wOne));   // a single photo reads as quiet
    const rank = keys.map((k, i) => { let r = 0; while (i - r > 0 && keys[i - r - 1] === k) r++; return r; });   // place within its day (photos are in date order)

    const photos = manifest.items.map((it, i) => {
      const date = dates[i], yi = YEARS.indexOf(date.getFullYear());
      const w = it.e ? WEIGHT_ESTIMATED : weightOf(counted.get(keys[i]) || 0);
      const lift = rnd();
      const L = CARD_L * (CARD_GROW.base + CARD_GROW.range * w) * (1 + (lift - 0.5) * 2 * CARD_JITTER), ar = it.w / it.h;
      const cw = ar >= 1 ? L : L * ar, ch = ar >= 1 ? L / ar : L;
      const minutes = date.getHours() * 60 + date.getMinutes();
      const angle = (dayOfYear(date) + minutes / 1440) / daysIn(date.getFullYear()) * 360;   // Jan 1 = front; a day's photos sit apart in time order
      // w is the day's weight from here on; pw × ph keep the photo's pixel size
      const hw = heatOf(w);                                                    // the inner ring's heat colour
      return { ...it, pw: it.w, ph: it.h, date, yi, w, hw, dk: keys[i], angle, t: yi * 360 + angle,
        cw, ch,
      };
    });
    const N = photos.length;
    const nVideo = photos.filter((p) => p.v).length;
    const shadeOf = (p) => lerp(SHADE_W.quiet, SHADE_W.heavy, p.w);

    // ---------- Photo view: the library ring ----------
    // Each day is one column at its place in the year; its photos stack outward, one row each, first photo innermost.
    photos.forEach((p, i) => {
      const k = rank[i], first = photos[i - k], days = daysIn(first.date.getFullYear());
      const h = LIB.row * (1 + LIB.rowGrow * k), r = LIB.base + (LIB.row + LIB.gap) * Math.pow(k, LIB.stackPow) + h / 2;
      Object.assign(p, { la: (dayOfYear(first.date) + 0.5) / days * 360, lr: r, lh: h, ly: -k * 0.4,   // a hair higher per row, so stacked tiles never flicker
                         lw: 2 * Math.PI * r / days * Math.min(LIB.maxSpan, LIB.fill + LIB.widen * k) });
    });
    // The inner ring: the day's arc is shared between its photos, each one a thin line (the middle of the photo, stretched
    // across the ring), so a busy day reads as a dense run of fine streaks.
    const lineR = LIB.base - LIB.band / 2 - 2, lineLen = LIB.band - 6;
    photos.forEach((p, i) => {
      const k = rank[i], first = photos[i - k], days = daysIn(first.date.getFullYear());
      let n = k + 1; while (i - k + n < N && photos[i - k + n].dk === p.dk) n++;
      Object.assign(p, { lineA: (dayOfYear(first.date) + (k + 0.5) / n) / days * 360, lineW: 2 * Math.PI * lineR / days / n * 1.04 });
    });

    const yearAt = (T) => Math.max(0, Math.min(YEARS.length - 1, Math.floor(T / 360)));
    const dateAtT = (T) => { const k = yearAt(T); return new Date(YEARS[k], 0, 1 + Math.round((T - k * 360) / 360 * 365)); };
    function nearestPhoto(T) {                      // photos are in date order, so in T order too
      let lo = 0, hi = N - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (photos[mid].t < T) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(photos[lo - 1].t - T) <= Math.abs(photos[lo].t - T)) lo--;
      return lo;
    }

    // "Most active": the 30 days of the year holding the most photos, named by season (early, mid or late). Shown only
    // in the heat view, on hover: that stretch of the ring lights up, and the tip names it.
    function mostActive(k) {
      const perDay = new Float32Array(366);
      for (const p of photos) if (p.yi === k && !p.e) perDay[dayOfYear(p.date)]++;
      let best = -1, bestSum = 0;
      for (let s = 0; s < 366; s++) { let sum = 0; for (let o = 0; o < 30; o++) sum += perDay[(s + o) % 366]; if (sum > bestSum) { bestSum = sum; best = s; } }
      if (best < 0 || bestSum < 3) return null;
      const m = new Date(YEARS[k], 0, 1 + best + 15).getMonth(), season = SEASONS.find((s) => s.months.includes(m));
      return { start: best, label: ["early", "mid", "late"][season.months.indexOf(m)] + " " + season.name.toLowerCase() };
    }
    const peaks = YEARS.map((_, k) => mostActive(k));
    photos.forEach((p) => { const pk = peaks[p.yi]; p.peak = pk && (dayOfYear(p.date) - pk.start + 366) % 366 < 30 ? 1 : 0; });

    // ---------- WebGL ----------
    const canvas = $("#gl");
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch (e) { return fail("This browser cannot draw the 3D ring (WebGL is off or unsupported). Try Chrome, Safari or Edge."); }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const isGL2 = renderer.capabilities.isWebGL2;
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const scene = new THREE.Scene();
    const cam3 = new THREE.PerspectiveCamera(45, 1, 5, 400000);
    // The scene is built in CSS space (x right, y down, z toward the viewer), exactly as the prototype's
    // transforms; one flip of y at the root turns it into WebGL space. Same numbers, same picture.
    const world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);
    // Colours shared by every shader, so the theme and the light switch change them in one place
    const col = (hex) => new THREE.Color(hex);
    const U = {
      uBg: { value: col(THEME.light.bg) }, uFg: { value: col(THEME.light.fg) }, uDark: { value: 0 },
      uHeat: { value: 0 }, uRamp: { value: HEAT_RAMP.map(col) }
    };
    // The ring is drawn off screen first, then once more through a pass that fades and streaks the edges,
    // so photos leaving the screen fade into the stage and smear outward, more while the ring is turning.
    // stencilBuffer: in r128 that is what gets a 24-bit depth buffer; with the 16-bit default, piled years only 18 px apart flicker through each other
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: true };
    const rt = isGL2 && THREE.WebGLMultisampleRenderTarget ? Object.assign(new THREE.WebGLMultisampleRenderTarget(1, 1, rtOpts), { samples: 4 })
                                                           : new THREE.WebGLRenderTarget(1, 1, rtOpts);
    const post = new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture }, aspect: { value: 1 }, blur: { value: EDGE_BLUR }, vignette: { value: VIGNETTE }, focus: { value: 0 }, uBg: U.uBg },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D map; uniform float aspect, blur, vignette, focus; uniform vec3 uBg; varying vec2 vUv;
        void main() {
          vec2 d = vUv - 0.5; d.x *= aspect;
          float r = length(d) / length(vec2(0.5 * aspect, 0.5));       // 0 at the centre, 1 in the corners
          float edge = smoothstep(0.35, 1.0, r);
          vec2 dir = (vUv - 0.5) * blur * edge * edge / 15.0;          // streak outward from the centre
          vec3 c = vec3(0.0);
          for (int i = 0; i < 16; i++) {
            float fi = float(i);                                       // plus, behind a clicked bubble, a soft blur all over
            vec2 o = focus * sqrt((fi + 0.5) / 16.0) * vec2(cos(fi * 2.39996) / aspect, sin(fi * 2.39996));
            c += texture2D(map, vUv - dir * fi + o).rgb;
          }
          c /= 16.0;
          gl_FragColor = vec4(mix(c, uBg, vignette * smoothstep(0.45, 1.05, r)), 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); postQuad.frustumCulled = false; postScene.add(postQuad);
    const _size = new THREE.Vector2();
    function resize() {
      const w = innerWidth, h = innerHeight, P = perspective();
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(_size); rt.setSize(_size.x, _size.y); post.uniforms.aspect.value = w / h;
      cam3.fov = 2 * Math.atan(h / 2 / P) / D; cam3.aspect = w / h;
      cam3.position.set(0, 0, P); cam3.lookAt(0, 0, 0); cam3.updateProjectionMatrix();
    }
    resize();

    const grey = new THREE.DataTexture(new Uint8Array([217, 217, 217, 255]), 1, 1, THREE.RGBAFormat); grey.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1, 1);
    const corner = { value: 12 };                       // corner radius in card units, shared by every card; set from CORNER_PX each frame
    // One shader for the tiles, the inner ring's lines and the raised photos: a rounded rectangle filled with the photo.
    // uHide fades the inner ring's lines out when the light switch turns it to heat colours.
    const FRAG = `
      uniform sampler2D map; uniform float uCorner, uHide, uMinShade, uTint, uPeakOn; uniform vec3 uBg, uRamp[5];
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey; varying float vW; varying float vPeak;
      vec3 ramp(float t) {
        t = clamp(t, 0.0, 1.0) * 4.0;
        vec3 c = mix(uRamp[0], uRamp[1], clamp(t, 0.0, 1.0));
        c = mix(c, uRamp[2], clamp(t - 1.0, 0.0, 1.0));
        c = mix(c, uRamp[3], clamp(t - 2.0, 0.0, 1.0));
        return mix(c, uRamp[4], clamp(t - 3.0, 0.0, 1.0));
      }
      void main() {
        float hs = 0.5 * min(vSize.x, vSize.y), r = min(uCorner, hs);
        vec2 q = abs((vLoc - 0.5) * vSize) - (0.5 * vSize - r);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;      // distance outside the rounded rectangle
        float alpha = clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0) * (1.0 - uHide);
        if (alpha <= 0.0) discard;
        vec3 c = texture2D(map, vUv).rgb;
        vec3 heat = mix(ramp(0.2 + 0.8 * vW), vec3(1.0), pow(vW, 3.0) * 0.4 * vLoc.y);   // heat: the day's colour, white-hot toward the outer end on heavy days
        c = mix(c, heat, uTint);
        c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), vGrey);     // past years in black and white
        float s = max(vShade, uMinShade * (1.0 - vGrey));               // past years keep their own fade
        s *= 1.0 - 0.6 * uPeakOn * (1.0 - vPeak);                        // hovering the heat ring: the most active stretch stands out
        c = mix(c, vec3(1.0), 0.18 * uPeakOn * vPeak);
        gl_FragColor = vec4(mix(uBg, c, s), alpha);                     // fading toward the stage stands in for opacity
      }`;
    const COVER = `
      vec2 cover(vec2 st, float photo, float quad) {     // fill the shape, cropping the photo's middle (as CSS object-fit: cover)
        return quad < photo ? vec2(0.5 + (st.x - 0.5) * quad / photo, st.y) : vec2(st.x, 0.5 + (st.y - 0.5) * photo / quad);
      }`;
    const VERT_INST = `
      attribute vec4 aUv; attribute float aShade; attribute float aGrey; attribute float aW; attribute float aPeak;
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey; varying float vW; varying float vPeak;
      ${COVER}
      void main() {
        vShade = aShade; vGrey = aGrey; vLoc = uv; vW = aW; vPeak = aPeak;
        vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        vec2 st = cover(uv, aUv.z / aUv.w, vSize.x / vSize.y);
        vUv = vec2(aUv.x + st.x * aUv.z, 1.0 - (aUv.y + st.y * aUv.w));
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`;
    const VERT_HERO = `
      uniform vec4 uvRect; uniform float shade; uniform vec2 uSize; uniform float uPhoto;
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey; varying float vW; varying float vPeak;
      ${COVER}
      void main() {
        vShade = shade; vGrey = 0.0; vLoc = uv; vSize = uSize; vW = 0.0; vPeak = 0.0;   // raised cards are always from the selected year
        vec2 st = cover(uv, uPhoto, uSize.x / uSize.y);
        vUv = vec2(uvRect.x + st.x * uvRect.z, 1.0 - (uvRect.y + st.y * uvRect.w));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`;

    const loader = new THREE.TextureLoader();
    function loadTexture(src, done) {              // src: a media path, or a canvas made from the visitor's photos; done(texture | null)
      if (src && typeof src !== "string") return done(new THREE.CanvasTexture(src));
      if (src == null) return done(null);
      mediaURL(src).then((url) => {
        if (!url) return done(null);
        loader.load(url, (tex) => { freeURL(url); done(tex); }, undefined, () => { freeURL(url); done(null); });
      });
    }

    // ---------- Calendar guides: a faint circle with a tick at each month, one per year ----------
    const GUIDE_FRAG = `
      uniform vec3 uFg; uniform float uShade, uTickR, uTickLen, uTickA, uTickW, uCircle; uniform float uMonths[12];
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float f = fract(atan(vP.x, vP.y) / 6.28318531 + 1.0);         // share of the year, Jan 1 = 0
        float best = 1.0;
        for (int m = 0; m < 12; m++) { float dm = abs(f - uMonths[m]); best = min(best, min(dm, 1.0 - dm)); }
        float dpx = best * 6.28318531 * r, aw = max(fwidth(dpx), 1e-3), rw = max(fwidth(r), 1e-3);
        float tick = (1.0 - smoothstep(uTickW, uTickW + aw, dpx)) * smoothstep(uTickR - 2.0, uTickR + 2.0, r) * (1.0 - smoothstep(uTickR + uTickLen - 2.0, uTickR + uTickLen + 2.0, r));
        float circle = 1.0 - smoothstep(0.5 * rw, 1.5 * rw, abs(r - uTickR));
        float a = max(tick * uTickA, circle * uCircle) * uShade;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uFg, a);
      }`;
    const monthStarts = MONTHS.map((_, m) => dayOfYear(new Date(2025, m, 1)) / 365);
    const guideHalf = TICKS.r + TICKS.len + 20, guideGeo = new THREE.PlaneGeometry(guideHalf * 2, guideHalf * 2);
    const guides = YEARS.map(() => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uFg: U.uFg, uShade: { value: 1 }, uTickR: { value: TICKS.r }, uTickLen: { value: TICKS.len },
          uTickA: { value: TICKS.alpha }, uTickW: { value: TICKS.width }, uCircle: { value: TICKS.circle }, uMonths: { value: monthStarts } },
        vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: GUIDE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true }
      });
      const mesh = new THREE.Mesh(guideGeo, mat); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = -1;
      world.add(mesh);
      return mesh;
    });

    const yearYs = new Float32Array(YEARS.length);   // each year ring's height, shared by the cards, guides and volume

    // ---------- Photos: one instanced mesh per atlas, ~144 tiles each, one draw call each; and the same again as the inner ring's lines ----------
    const A = manifest.atlas.size;
    const atlasTex = manifest.atlas.files.map(() => grey);
    const tileCorner = { value: 1.5 };                  // px: the library's tiles are nearly sharp
    const tileHide = { value: 0 };                      // Stacks off: the tiles sit folded into their lines, hidden
    const peakOn = { value: 0 };                       // the heat ring's most active stretch, lit while hovering it
    const cardUniforms = (map, round, hide, minShade, tint, peak) => ({ map: { value: map }, uCorner: round || tileCorner, uHide: hide || { value: 0 },
      uMinShade: { value: minShade || 0 }, uTint: tint || { value: 0 }, uPeakOn: peak || { value: 0 }, uRamp: U.uRamp, uBg: U.uBg });
    const meshes = manifest.atlas.files.map((_, ai) => {
      const members = photos.map((p, k) => k).filter((k) => photos[k].a[0] === ai);
      const mat = new THREE.ShaderMaterial({ uniforms: cardUniforms(grey, null, tileHide), vertexShader: VERT_INST, fragmentShader: FRAG,
        side: THREE.DoubleSide, extensions: { derivatives: true }, alphaToCoverage: true });   // rounded corners stay smooth under MSAA
      const mesh = new THREE.InstancedMesh(geo, mat, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array(members.length * 4), shade = new Float32Array(members.length), bw = new Float32Array(members.length), wt = new Float32Array(members.length), pk = new Float32Array(members.length);
      members.forEach((k, j) => {
        const a = photos[k].a; photos[k].mi = ai; photos[k].ii = j;
        uv.set([a[1] / A, a[2] / A, a[3] / A, a[4] / A], j * 4); shade[j] = shadeOf(photos[k]); wt[j] = photos[k].hw; pk[j] = photos[k].peak;
      });
      mesh.geometry = geo.clone();
      mesh.geometry.setAttribute("aUv", new THREE.InstancedBufferAttribute(uv, 4));
      mesh.geometry.setAttribute("aShade", new THREE.InstancedBufferAttribute(shade, 1));
      mesh.geometry.setAttribute("aGrey", new THREE.InstancedBufferAttribute(bw, 1));
      mesh.geometry.setAttribute("aW", new THREE.InstancedBufferAttribute(wt, 1));
      mesh.geometry.setAttribute("aPeak", new THREE.InstancedBufferAttribute(pk, 1));
      mesh.frustumCulled = false; mesh.userData.members = members;
      world.add(mesh);
      // the inner ring's lines: the same photos (sharing the tiles' atlas, shade and grey), each drawn as a thin sliver
      const lineMat = new THREE.ShaderMaterial({ uniforms: cardUniforms(grey, { value: 0 }, null, LIB.lineShade, U.uHeat, peakOn), vertexShader: VERT_INST, fragmentShader: FRAG,
        side: THREE.DoubleSide, extensions: { derivatives: true }, alphaToCoverage: true });
      // (its own geometry object, holding the very same attributes: in three r128 two instanced meshes on one geometry
      // share a vertex binding, so the lines would be drawn where the tiles are)
      const lineGeo = new THREE.BufferGeometry(); lineGeo.setIndex(mesh.geometry.getIndex());
      for (const name of Object.keys(mesh.geometry.attributes)) lineGeo.setAttribute(name, mesh.geometry.getAttribute(name));
      const lines = new THREE.InstancedMesh(lineGeo, lineMat, members.length);
      lines.frustumCulled = false; mesh.userData.lines = lines;
      world.add(lines);
      return mesh;
    });
    let atlasesLoaded = 0;
    manifest.atlas.files.forEach((f, ai) => album.atlas(ai).then((src) => loadTexture(src, (tex) => {
      if (!tex) return;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = maxAniso;
      atlasTex[ai] = tex; meshes[ai].material.uniforms.map.value = meshes[ai].userData.lines.material.uniforms.map.value = tex; atlasesLoaded++;
      heroes.forEach((h) => h.k >= 0 && photos[h.k].mi === ai && h.stage === "tile" && h.useTile());
    })));

    // Medium-size images come in sheets of four neighbours; loaded on demand, the last few kept.
    const S = manifest.sheet.size, sheets = new Map();
    function sheet(si) {
      let e = sheets.get(si);
      if (!e) {
        e = { tex: null, last: 0 };
        e.ready = new Promise((res) => album.sheet(si).then((src) => loadTexture(src, (tex) => {
          if (tex) {
            tex.generateMipmaps = isGL2; tex.minFilter = isGL2 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
            tex.anisotropy = maxAniso; e.tex = tex;
          }
          res(tex);
        }), () => res(null)));
        sheets.set(si, e);
        if (sheets.size > 12) {                                      // drop the least recently used sheet not on screen
          const inUse = new Set(heroes.filter((h) => h.k >= 0).map((h) => photos[h.k].m[0]));
          const old = [...sheets.entries()].filter(([i, v]) => !inUse.has(i) && v.tex).sort((x, y) => x[1].last - y[1].last)[0];
          if (old) { old[1].tex.dispose(); sheets.delete(old[0]); }
        }
      }
      e.last = performance.now();
      return e.ready;
    }

    // Hero cards: the photo at the front and the hovered photo, drawn on their own with the sharper image (or the video).
    function makeHero() {
      const mat = new THREE.ShaderMaterial({ uniforms: { ...cardUniforms(grey, corner), uvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, shade: { value: 1 },
                     uSize: { value: new THREE.Vector2(1, 1) }, uPhoto: { value: 1 },
                   },
        vertexShader: VERT_HERO, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true, extensions: { derivatives: true } });   // drawn after the ring, in renderOrder
      const mesh = new THREE.Mesh(geo, mat); mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.frustumCulled = false;
      world.add(mesh);
      const video = document.createElement("video");
      video.muted = true; video.loop = true; video.playsInline = true; video.setAttribute("playsinline", ""); video.preload = "auto";
      const vtex = new THREE.VideoTexture(video); vtex.minFilter = THREE.LinearFilter;
      const h = { k: -1, mesh, video, stage: "none", stand: 0, timer: 0,
        useTile() { const p = photos[this.k]; mat.uniforms.map.value = atlasTex[p.mi]; mat.uniforms.uvRect.value.set(p.a[1] / A, p.a[2] / A, p.a[3] / A, p.a[4] / A); this.stage = "tile"; },
        set(k) {
          if (k === this.k) return;
          if (this.k >= 0) hideInstance(this.k, false);
          this.k = k; video.pause(); video.removeAttribute("src"); video.load();
          if (k < 0) { mesh.visible = false; this.stage = "none"; return; }
          hideInstance(k, true); mesh.visible = true; this.useTile();
          mat.uniforms.uPhoto.value = photos[k].pw / photos[k].ph;
          clearTimeout(this.timer);
          // Sharper image and video only once the photo stays put, so a fast spin through a dense month loads nothing extra.
          this.timer = setTimeout(() => {
            if (this.k !== k) return;
            const p = photos[k];
            sheet(p.m[0]).then((tex) => {
              if (this.k !== k || !tex || this.stage === "video") return;
              mat.uniforms.map.value = tex; mat.uniforms.uvRect.value.set(p.m[1] / S, p.m[2] / S, p.m[3] / S, p.m[4] / S); this.stage = "medium";
            });
            if (p.v) album.clip(p.v).then((url) => {
              if (this.k !== k || !url) return;
              video.src = url;
              video.onplaying = () => { if (this.k === k) { mat.uniforms.map.value = vtex; mat.uniforms.uvRect.value.set(0, 0, 1, 1); this.stage = "video"; } };
              const pr = video.play(); if (pr && pr.catch) pr.catch(() => {});
            });
          }, this === heroHov ? 60 : 220);
        }
      };
      return h;
    }
    const heroCur = makeHero(), heroHov = makeHero();
    const heroes = [heroCur, heroHov];

    // ---------- Matrices (CSS transform order: left to right) ----------
    const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const T3 = (x, y, z) => _t.makeTranslation(x, y, z), RX = (a) => _t.makeRotationX(a * D), RY = (a) => _t.makeRotationY(a * D),
          RZ = (a) => _t.makeRotationZ(a * D), SC = (x, y, z) => _t.makeScale(x, y, z);
    // A photo lies flat in the ring, top outward: folded into its line, or (Stacks, state.sv = 1) out in its library
    // tile. The photo raised at the front (stand) lifts out of there and turns to face you at full size (grown further
    // while diving into it).
    const _rtInv = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _mq = new THREE.Matrix4(), _qI = new THREE.Quaternion();
    function cardMatrix(out, p, y, stand, spread, big) {
      const sv = state.sv, ang = lerp(p.lineA, p.la, sv), rad = lerp(lineR, p.lr, sv), sl = Math.sin(ang * D), cl = Math.cos(ang * D);
      const facing = -(state.cam.tilt + state.pitch), level = -state.cam.roll * LEVEL;
      const toFace = (((-(state.spin + state.yaw) - ang) % 360) + 540) % 360 - 180;   // shortest turn from lying along the ring to facing you
      const grow = big || (state.mode === "overview" ? OVERVIEW_SCALE : STAND_SCALE) * state.diveK;
      const w = lerp(lerp(p.lineW, p.lw, sv), p.cw * grow, stand), ht = lerp(lerp(lineLen, p.lh, sv), p.ch * grow, stand);
      out.identity().multiply(T3(sl * rad, y + bowlY(rad) + p.ly * sv, cl * rad));
      if (stand > 0) out.multiply(_mq.makeRotationFromQuaternion(_qs.copy(_qI).slerp(_rtInv, stand)));   // a raised photo undoes the ring's lean, to face you squarely
      return out.multiply(RY(ang + toFace * stand)).multiply(RX(lerp(90 + LIB.bowl, facing, stand)))
        .multiply(T3(0, 0, 160 * stand)).multiply(RZ(level * stand)).multiply(SC(w, ht, 1));
    }
    const bowlY = (r) => -(r - lineR) * Math.tan(LIB.bowl * D);   // the ring rises outward (up is −y), level at the middle of the lines
    const lineIn = lineR - lineLen / 2;            // the ring's inner edge, where every line starts
    function lineMatrix(out, p, y) {               // a photo's line on the bowl, outward from the inner edge; in the heat view as long as its day is heavy
      const a = p.lineA * D, len = lerp(lineLen, LIB.heatLen.min + (LIB.heatLen.max - LIB.heatLen.min) * p.hw, state.heat), rc = lineIn + len / 2;
      return out.identity().multiply(T3(Math.sin(a) * rc, y - 0.5 + bowlY(rc), Math.cos(a) * rc)).multiply(RY(p.lineA)).multiply(RX(90 + LIB.bowl)).multiply(SC(p.lineW, len, 1));
    }
    const hidden = new Set();
    let instancesDirty = true;
    function hideInstance(k, on) { if (on) hidden.add(k); else hidden.delete(k); instancesDirty = true; }
    let shownYi = -1;                                // the selected year; every later year is hidden
    function writeInstances() {
      for (const mesh of meshes) {
        const arr = mesh.instanceMatrix.array, lineArr = mesh.userData.lines.instanceMatrix.array, members = mesh.userData.members;
        for (let j = 0; j < members.length; j++) {
          const k = members[j], p = photos[k], later = p.yi > shownYi;
          (hidden.has(k) || later ? ZERO : cardMatrix(_m, p, yearYs[p.yi], 0, state.spread)).toArray(arr, j * 16);
          (later ? ZERO : lineMatrix(_m, p, yearYs[p.yi])).toArray(lineArr, j * 16);
        }
        mesh.instanceMatrix.needsUpdate = mesh.userData.lines.instanceMatrix.needsUpdate = true;
      }
      instancesDirty = false;
    }
    let shadeKey = "";
    function writeShades(cur, yi) {
      const key = cur + ":" + yi; if (key === shadeKey) return; shadeKey = key;
      for (const mesh of meshes) {
        const attr = mesh.geometry.getAttribute("aShade"), greyAttr = mesh.geometry.getAttribute("aGrey"), members = mesh.userData.members;
        for (let j = 0; j < members.length; j++) {
          const k = members[j], p = photos[k], back = yi - p.yi;      // how many years into the past (future years are hidden)
          attr.array[j] = back <= 0 ? (cur >= 0 && Math.abs(k - cur) <= 3 ? Math.max(SHADE.near, shadeOf(p)) : shadeOf(p))
                                    : Math.max(PAST.min, PAST.start * Math.pow(PAST.step, back - 1)) * (PAST_W.base + PAST_W.range * p.w);
          greyAttr.array[j] = back > 0 ? 1 : 0;
        }
        attr.needsUpdate = greyAttr.needsUpdate = true;
      }
    }
    function placeGuides() {                        // each year's calendar circle at its ring's height; past years fade, future ones hide
      guides.forEach((mesh, k) => {
        const back = shownYi - k;
        mesh.visible = back >= 0;
        if (!mesh.visible) return;
        mesh.matrix.copy(T3(0, yearYs[k], 0)).multiply(RX(90)); mesh.matrixWorldNeedsUpdate = true;
        mesh.material.uniforms.uShade.value = back === 0 ? 1 : Math.max(PAST.min, PAST.start * Math.pow(PAST.step, back - 1)) * 0.5;
      });
    }

    // ---------- Footer: date fields, day count; year bar ----------
    const msel = $("#msel"), dsel = $("#dsel");
    for (let m = 1; m <= 12; m++) msel.add(new Option(pad(m), m));
    for (let d = 1; d <= 31; d++) dsel.add(new Option(pad(d), d));
    function jumpToDate() {
      const want = new Date(YEARS[state.yearLock], +msel.value - 1, +dsel.value);
      let best = 0, bestD = Infinity;
      photos.forEach((p, i) => { const dd = Math.abs(p.date - want); if (dd < bestD) { bestD = dd; best = i; } });
      goTo(best);
    }
    [msel, dsel].forEach((s) => s.addEventListener("change", jumpToDate));
    function goToYear(k) {
      if (k < 0 || k >= YEARS.length) return;
      const i = photos.findIndex((p) => p.yi === k); if (i >= 0) goTo(i);
    }
    $("#yNext").addEventListener("click", () => goToYear(state.yearLock + 1));
    $("#yPrev").addEventListener("click", () => goToYear(state.yearLock - 1));
    let shownYear = -1;
    function showYear(k) {
      if (k === shownYear) return;
      const ul = $("#years");
      ul.classList.remove("up", "down"); void ul.offsetWidth;
      if (shownYear >= 0) ul.classList.add(k > shownYear ? "up" : "down");
      shownYear = k;
      $("#yNow").textContent = YEARS[k]; $("#yNext").textContent = YEARS[k + 1] || ""; $("#yPrev").textContent = YEARS[k - 1] || "";
    }
    let readoutKey = "";
    function readout(d, withTime) {
      const key = d.toDateString() + (withTime ? d.getTime() : "x");
      if (key === readoutKey) return; readoutKey = key;
      $("#mv").textContent = pad(d.getMonth() + 1); msel.value = d.getMonth() + 1;
      $("#dv").textContent = pad(d.getDate()); dsel.value = d.getDate();
      if (withTime) {
        const h = d.getHours();
        $("#hv").textContent = pad(((h + 11) % 12) + 1); $("#minv").textContent = pad(d.getMinutes()); $("#ampm").textContent = h >= 12 ? "PM" : "AM";
      } else { $("#hv").textContent = "--"; $("#minv").textContent = "--"; $("#ampm").textContent = ""; }
    }
    // Time field: when the day shown has more than one photo, it becomes a list of that day's photos by time;
    // picking one brings it to the front. Days run from 4 AM, as the weights do, so the count matches the glow.
    const tsel = $("#tsel"), timeField = $("#timeField"), countEl = $("#count");
    const dayOf = (i) => photos[i].dk;
    const clock = (d) => `${pad(((d.getHours() + 11) % 12) + 1)}:${pad(d.getMinutes())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
    const photosLabel = (n) => n === 1 ? "1 photo" : `${n} photos`;
    function dayRange(i) {
      let a = i, b = i;
      while (a > 0 && dayOf(a - 1) === dayOf(i)) a--;
      while (b < N - 1 && dayOf(b + 1) === dayOf(i)) b++;
      return [a, b];
    }
    let timesKey = "";
    function updateTimes(i) {
      if (i < 0) { if (timesKey) { timesKey = ""; tsel.textContent = ""; tsel.disabled = true; timeField.classList.remove("multi"); countEl.textContent = ""; } return; }
      const [a, b] = dayRange(i), key = a + ":" + b;
      if (key !== timesKey) {
        timesKey = key; tsel.textContent = "";
        for (let k = a; k <= b; k++) tsel.add(new Option(`${clock(photos[k].date)}  (${k - a + 1} of ${b - a + 1})`, k));
        tsel.disabled = a === b; timeField.classList.toggle("multi", a < b);
        tsel.setAttribute("aria-label", a < b ? `Photo time: ${b - a + 1} photos on this day` : "Photo time");
        countEl.textContent = photosLabel(b - a + 1);
      }
      tsel.value = i;
    }
    tsel.addEventListener("change", () => { goTo(+tsel.value); tsel.blur(); });

    // ---------- Season and month marks: the ring carries its own calendar ----------
    const marks = $("#marks");
    const seasonEls = SEASONS.map((s) => { const e = document.createElement("span"); e.className = "season"; e.textContent = s.name; marks.append(e); return e; });
    const monthEls = MONTHS.map((m) => { const e = document.createElement("span"); e.className = "month"; e.textContent = m; marks.append(e); return e; });
    const _lab = new THREE.Vector3(), _lab2 = new THREE.Vector3(), _pt = { x: 0, y: 0, s: 1 };
    // A point on the ring (on its bowl) → screen px, and a scale for text there: how large 100 px of ring looks there
    // against how large it looks at the ring's centre, so labels stay put on the ring and change size only with depth.
    // Null when behind the camera or off the screen.
    let refPx = 1;
    function pxPer100(x, y, z) {                    // screen px across 100 px of ring at a point (0 when behind the camera)
      _lab.set(x, y, z).applyMatrix4(world.matrix); _lab2.set(x + 100, y, z).applyMatrix4(world.matrix);
      if (_lab.z > cam3.position.z - 20) return 0;
      _lab.project(cam3); _lab2.project(cam3);
      return Math.hypot((_lab2.x - _lab.x) * innerWidth / 2, (_lab2.y - _lab.y) * innerHeight / 2);
    }
    function screenAt(angleDeg, r, y, out) {
      const a = angleDeg * D, yy = y + bowlY(r), back = cam3.position.z - 20;
      _lab.set(Math.sin(a) * r, yy, Math.cos(a) * r).applyMatrix4(world.matrix);
      _lab2.set(Math.sin(a) * r + Math.cos(a) * 100, yy, Math.cos(a) * r - Math.sin(a) * 100).applyMatrix4(world.matrix);
      if (_lab.z > back || _lab2.z > back) return null;
      _lab.project(cam3); _lab2.project(cam3);
      out.x = (_lab.x + 1) / 2 * innerWidth; out.y = (1 - _lab.y) / 2 * innerHeight;
      if (!isFinite(out.x) || !isFinite(out.y) || out.x < -80 || out.x > innerWidth + 80 || out.y < -40 || out.y > innerHeight + 40) return null;
      out.s = Math.max(LABELS.minScale, Math.min(LABELS.maxScale, Math.hypot((_lab2.x - _lab.x) * innerWidth / 2, (_lab2.y - _lab.y) * innerHeight / 2) / refPx));
      return out;
    }
    function place(e, at) {
      e.classList.toggle("on", !!at);
      if (at) e.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${at.s.toFixed(3)})`;
    }
    function placeMarks() {
      marks.classList.toggle("away", state.diveT > 0.02);       // an opened photo: the ring behind it, and its calendar, step back
      const y = yearYs[shownYi], showMonths = state.mode === "focus" || state.zoom > MONTH_LABEL_ZOOM;
      refPx = pxPer100(0, y, 0) || refPx;
      SEASONS.forEach((s, k) => place(seasonEls[k], screenAt(s.mid / 365 * 360, LABELS.season, y, _pt)));
      monthEls.forEach((e, m) => place(e, showMonths ? screenAt((monthStarts[m] + 0.04) * 360, LABELS.month, y, _pt) : null));
    }

    // ---------- State ----------
    const state = {
      T: 0, TT: 0, spin: 0,
      gap: GAP_COLLAPSED, gapT: GAP_COLLAPSED, expanded: false,
      mode: "focus", cam: { ...view("focus") }, camT: { ...view("focus") },
      yaw: 0, yawT: 0, pitch: 0, pitchT: 0, zoom: 1, zoomT: 1,
      hover: -1, stand: 0, yiS: 0, spread: 0, vel: 0, current: -1, started: false,
      pan: { x: 0, y: 0 }, panT: { x: 0, y: 0 }, yearLock: 0, peak: 0, peakT: 0, heat: 0, heatT: 0, stacks: true, stack: 1, sv: 1, diveK: 1, dive: false, diveT: 0, free: false   // free: nothing selected (after a click on empty space)
    };
    function setMode(mode) {
      state.mode = mode; state.camT = { ...view(mode) };
      if (mode === "overview") state.dive = false;
      $("#btnView").setAttribute("aria-pressed", mode === "overview" ? "true" : "false");
    }
    function setExpanded(on) { state.expanded = on; state.gapT = on ? GAP_EXPANDED : GAP_COLLAPSED; $("#btnExpand").setAttribute("aria-pressed", on ? "true" : "false"); }
    function setHeat(on) {                         // the light switch: the ring as photo lines, or as heat colours only
      state.heatT = on ? 1 : 0;
      if (on) { state.dive = false; setHover(-1); } else heatTip(-1);
      const b = $("#btnSwitch");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("aria-label", on ? "The ring shows heat. Switch to the photo lines" : "The ring shows photo lines. Switch to heat");
      document.body.classList.toggle("heat", on);
      $("#btnStacks").setAttribute("aria-disabled", on ? "true" : "false");   // heat is colours only: no stacks
    }
    function setStacks(on) {                       // opt-in: each day's photos stacked outward as library columns
      state.stacks = on;
      $("#btnStacks").setAttribute("aria-pressed", on ? "true" : "false");
    }
    function goTo(i) {                             // to a photo (and its year)
      i = Math.max(0, Math.min(N - 1, i));
      if (photos[i].yi !== state.yearLock) { state.yearLock = photos[i].yi; state.T = state.TT = photos[i].t; }   // another year: straight there
      else state.TT = state.T + ((((photos[i].t - state.T) % 360) + 540) % 360 - 180);   // the same year: the short way round the loop
      state.free = false; if (state.mode === "overview") setMode("focus");
    }
    // Scrolling turns the ring as a loop within its year: past Dec 31 it comes round to Jan 1 again. Only the year list
    // (or a photo in another year) moves to another year.
    function turn(deg) { state.TT += deg; state.dive = false; state.free = false; if (state.mode === "overview") setMode("focus"); }
    function letGo() {                             // a click on empty space: nothing selected, back to the overview
      state.dive = false; state.free = true; setHover(-1); setMode("overview");
    }
    const setZoom = (z) => { state.zoomT = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); };
    // Zoom toward a point on the screen: the view is panned so that what is under the pointer stays under it.
    function zoomAt(z, cx, cy) {
      const z0 = state.zoomT; setZoom(z);
      const f = state.zoomT / z0, ox = innerWidth / 2 + state.cam.ox * innerWidth + state.panT.x, oy = innerHeight / 2 + state.cam.oy * innerHeight + state.panT.y;
      state.panT.x += (cx - ox) * (1 - f); state.panT.y += (cy - oy) * (1 - f);
    }

    // ---------- Input (only while the ring is live; the opening has its own handlers above) ----------
    const ownUI = "#header, #right";
    // Desktop: wheel / two-finger scroll turns the ring; trackpad pinch zooms (Chrome/Edge/Firefox send it as ctrl + wheel).
    addEventListener("wheel", (e) => {
      if (phase !== "live") return;
      e.preventDefault();
      if (e.ctrlKey) { zoomAt(state.zoomT * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); return; }   // trackpad pinch
      turn((e.deltaY + e.deltaX) * (e.deltaMode === 1 ? 16 : 1) * WHEEL_DEG);
    }, { passive: false });

    // Phone: ONE finger only turns the ring (time). TWO fingers only change the view: move them together to move the
    // view, pinch to zoom toward them. A gesture keeps the mode it started in until every finger is lifted, so the two never
    // blend (lifting one finger of a pinch does not suddenly start turning the ring). Expanded view is the button only.
    const touch = { mode: null, multi: false, x: 0, y: 0, axis: null, v: 0, t: 0, d0: 1, z0: 1, mx: 0, my: 0 };
    const two = (e) => { const a = e.touches[0], b = e.touches[1];
      return { d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; };
    addEventListener("touchstart", (e) => {
      if (phase !== "live" || e.target.closest(ownUI)) return;   // date fields, buttons, year list keep their taps
      if (e.touches.length >= 2) {
        const g = two(e);
        Object.assign(touch, { mode: "view", multi: true, d0: g.d, z0: state.zoomT, mx: g.x, my: g.y });
        return;
      }
      if (touch.mode === "view") return;                                     // a finger left over from a two-finger gesture
      Object.assign(touch, { mode: "turn", multi: false, x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null, v: 0, t: performance.now() });
    }, { passive: true });
    addEventListener("touchmove", (e) => {
      if (!touch.mode || phase !== "live") return;
      e.preventDefault();
      if (touch.mode === "view") {
        if (e.touches.length < 2) return;
        const g = two(e);
        state.panT.x += g.x - touch.mx; state.panT.y += g.y - touch.my;   // two fingers move the view …
        zoomAt(touch.z0 * g.d / touch.d0, g.x, g.y);                    // … and pinch zooms toward them
        touch.mx = g.x; touch.my = g.y;
        return;
      }
      const x = e.touches[0].clientX, y = e.touches[0].clientY, dx = x - touch.x, dy = touch.y - y; touch.x = x; touch.y = y;
      if (!touch.axis && Math.abs(dx) + Math.abs(dy) > 6) touch.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (!touch.axis) return;
      const deg = (touch.axis === "y" ? dy : -dx) * TOUCH_DEG;              // swipe up or left = forward in time
      const now = performance.now();
      touch.v = lerp(touch.v, deg / Math.max(1, now - touch.t), 0.4); touch.t = now;
      turn(deg);
    }, { passive: false });
    addEventListener("touchend", (e) => {
      if (touch.mode === "turn" && e.touches.length === 0 && touch.axis && performance.now() - touch.t < 80)
        turn(Math.max(-FLING_MAX, Math.min(FLING_MAX, touch.v * FLING_MS)));  // a flick keeps the ring turning a little
      if (e.touches.length === 0) touch.mode = null;
    }, { passive: true });
    addEventListener("touchcancel", () => { touch.mode = null; });
    // Safari on a Mac trackpad sends pinch as gesture events; on iPhone those duplicate the touches, so they are ignored there.
    let gestureZoom0 = 1;
    document.addEventListener("gesturestart", (e) => { e.preventDefault(); gestureZoom0 = state.zoomT; });
    document.addEventListener("gesturechange", (e) => { e.preventDefault(); if (!touch.mode && phase === "live") zoomAt(gestureZoom0 * e.scale, e.clientX || ptrPx.x, e.clientY || ptrPx.y); });

    // Picking: which photo is under the pointer (the raised photos first, then the stacks' tiles, or the ring of lines).
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
    const yearFirst = YEARS.map((_, k) => photos.findIndex((p) => p.yi === k));
    function pickLine() {                          // where the pointer meets the ring's plane: the photo whose line is there
      _inv.copy(world.matrix).invert();
      _o.copy(raycaster.ray.origin).applyMatrix4(_inv);
      _d.copy(raycaster.ray.origin).add(raycaster.ray.direction).applyMatrix4(_inv).sub(_o);
      if (Math.abs(_d.y) < 1e-6) return -1;
      const t = (yearYs[shownYi] - _o.y) / _d.y; if (t < 0) return -1;
      const x = _o.x + _d.x * t, z = _o.z + _d.z * t;
      const rr = Math.hypot(x, z);
      if (rr < lineIn - 12 || rr > lineIn + lerp(lineLen, LIB.heatLen.max, state.heat) + 12) return -1;   // only the ring itself answers
      const a = ((Math.atan2(x, z) / D) % 360 + 360) % 360;
      let best = -1, bestD = 2;                                   // the nearest photo within about two days
      for (let k = yearFirst[shownYi]; k >= 0 && k < N && photos[k].yi === shownYi; k++) {
        const dd = Math.abs(((photos[k].lineA - a) % 360 + 540) % 360 - 180);
        if (dd < bestD) { bestD = dd; best = k; }
      }
      return best;
    }
    function pick(cx, cy) {
      ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, cam3);
      if (!state.heatT) {
        const heroHits = raycaster.intersectObjects(heroes.filter((h) => h.k >= 0).map((h) => h.mesh), false);
        if (heroHits.length) return heroes.find((h) => h.mesh === heroHits[0].object).k;
      }
      if (state.sv > 0.5) {
        const hits = raycaster.intersectObjects(meshes, false);
        for (const hit of hits) { const k = hit.object.userData.members[hit.instanceId]; if (!hidden.has(k) && photos[k].yi === shownYi) return k; }
      }
      return pickLine();                                         // only the selected year answers the pointer
    }
    let drag = null, hoverQueued = null;
    const stage = $("#stage");
    stage.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, px: state.panT.x, py: state.panT.y, moved: false, touch: e.pointerType === "touch" };
    });
    addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.touch || phase !== "live") return;
        if (drag.moved) { stage.classList.add("dragging"); setHover(-1); }
        state.panT.x = drag.px + dx; state.panT.y = drag.py + dy;   // the view moves with the pointer, like a board
        return;
      }
      if (e.pointerType === "mouse") { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; ptrPx.x = e.clientX; ptrPx.y = e.clientY; }
      if (e.pointerType === "mouse" && phase === "live") hoverQueued = [e.clientX, e.clientY];
    });
    addEventListener("pointerup", (e) => {
      if (!drag) return;
      const moved = drag.moved, afterTwoFingers = drag.touch && touch.multi; drag = null; stage.classList.remove("dragging");
      if (afterTwoFingers) return;                               // lifting fingers after a two-finger gesture is not a tap
      if (moved || phase !== "live" || !e.target.closest("#stage")) return;
      const k = pick(e.clientX, e.clientY);
      if (k >= 0 && state.heatT) { state.TT = photos[k].t; state.free = false; }   // heat: a click on the ring picks that day, colours only
      else if (k >= 0) { setHover(-1); goTo(k); setMode("focus"); state.dive = true; }   // a click on a photo dives into it …
      else letGo();                                                                  // … and anywhere else lets go of everything
    });
    stage.addEventListener("pointerleave", () => { hoverQueued = null; setHover(-1); heatTip(-1); });
    // Heat view hover: a tip with the day under the pointer and its count; anywhere on the ring, the year's most active
    // stretch lights up (and the tip names it when the pointer is inside it). Nothing of this is shown otherwise.
    const tip = $("#tip"), tipDay = tip.querySelector(".day"), tipPeak = tip.querySelector(".peak");
    function heatTip(k, x, y) {
      state.peakT = k >= 0 ? 1 : 0;
      tip.classList.toggle("on", k >= 0);
      stage.classList.toggle("over-card", k >= 0);
      if (k < 0) return;
      const p = photos[k], [a, b] = dayRange(k), pk = peaks[p.yi];
      tipDay.textContent = `${MONTHS[p.date.getMonth()]} ${p.date.getDate()} · ${photosLabel(b - a + 1)}`;
      tipPeak.textContent = p.peak && pk ? `Most active: ${pk.label}` : "";
      tip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    // Hover: a photo comes forward.
    function setHover(k) {
      if (k === state.current || state.dive || state.heatT) k = -1;   // heat is colours only
      if (k === state.hover) return;
      state.hover = k; heroHov.set(k); heroHov.stand = 0;
      stage.classList.toggle("over-card", k >= 0);
    }
    function resetView() { state.yawT = 0; state.pitchT = 0; state.zoomT = 1; state.panT.x = state.panT.y = 0; }
    $("#btnReset").addEventListener("click", resetView);
    addEventListener("keydown", (e) => {
      if (phase !== "live" || e.target.tagName === "SELECT") return;
      const base = state.current >= 0 ? state.current : nearestPhoto(state.T);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") goTo(base + (state.current >= 0 || photos[base].t < state.T ? 1 : 0));
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") goTo(base - (state.current >= 0 || photos[base].t > state.T ? 1 : 0));
      if (e.key === "e" || e.key === "E") setExpanded(!state.expanded);
      if (e.key === "o" || e.key === "O") setMode(state.mode === "overview" ? "focus" : "overview");
      if (e.key === "r" || e.key === "R") resetView();
      if (e.key === "l" || e.key === "L") setHeat(!state.heatT);
      if ((e.key === "s" || e.key === "S") && !state.heatT) setStacks(!state.stacks);
      if (e.key === "Escape") letGo();
      if (e.key === "=" || e.key === "+") zoomAt(state.zoomT * 1.15, innerWidth / 2, innerHeight / 2);
      if (e.key === "-" || e.key === "_") zoomAt(state.zoomT / 1.15, innerWidth / 2, innerHeight / 2);
    });
    $("#btnView").addEventListener("click", () => setMode(state.mode === "overview" ? "focus" : "overview"));
    $("#btnExpand").addEventListener("click", () => setExpanded(!state.expanded));
    $("#btnSwitch").addEventListener("click", () => setHeat(!state.heatT));
    $("#btnStacks").addEventListener("click", () => { if (!state.heatT) setStacks(!state.stacks); });
    ["wheel", "pointerdown", "pointermove", "pointerup"].forEach((t) => $("#ui").addEventListener(t, (e) => { if (e.target.closest(ownUI)) e.stopPropagation(); }));

    // ---------- Frame ----------
    let warmTimer = 0;
    function setCurrent(i, T) {
      if (i !== state.current) {
        state.current = i;
        if (i >= 0 && state.hover === i) { state.hover = -1; heroHov.set(-1); }
        heroCur.set(i);
        clearTimeout(warmTimer);
        if (i >= 0) warmTimer = setTimeout(() => {               // once settled, warm the neighbours' sheets
          if (state.current !== i) return;
          if (i + 4 < N) sheet(photos[i + 4].m[0]);
          if (i - 4 >= 0) sheet(photos[i - 4].m[0]);
        }, 600);
      }
      const yi = yearAt(T);
      if (yi !== shownYi) { shownYi = yi; instancesDirty = true; if (state.hover >= 0 && photos[state.hover].yi !== yi) setHover(-1); }
      showYear(yi); writeShades(i, yi);
      const shown = state.hover >= 0 ? state.hover : i;          // a hovered photo takes over the date and time
      if (shown >= 0) readout(photos[shown].date, true); else readout(dateAtT(T), false);
      updateTimes(shown);
    }
    function yearY(k, yiS, spread) {
      const piled = Math.abs(k - yiS) * GAP_COLLAPSED, stacked = -(k - yiS) * GAP_EXPANDED;
      return piled * (1 - spread) + stacked * spread;
    }
    const F = new THREE.Matrix4().makeScale(1, -1, 1), _w = new THREE.Matrix4();
    const WINTER_A = SEASONS[0].mid / 365 * 360, _rt = new THREE.Matrix4(), _q = new THREE.Matrix4(), _fv = new THREE.Vector3();
    let lastYiS = -1, lastGap = -1, resetOff = null, lastT = 0;
    const ptr = { x: 0, y: 0 }, ptrPx = { x: innerWidth / 2, y: innerHeight / 2 }, _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
    function frame() {
      requestAnimationFrame(frame);
      if (hoverQueued && !drag) { const [x, y] = hoverQueued; hoverQueued = null; const k = pick(x, y); if (state.heatT) heatTip(k, x, y); else setHover(k); }
      state.peak = lerp(state.peak, state.peakT * state.heat, 0.12); peakOn.value = state.peak;

      const T0 = state.T;
      state.T = lerp(state.T, state.TT, SMOOTH * 1.3);
      const y0 = state.yearLock * 360, wrap = state.T < y0 ? 360 : state.T >= y0 + 360 ? -360 : 0;   // round the loop, within the year
      if (wrap) { state.T += wrap; state.TT += wrap; }
      const T0w = T0 + wrap;
      const vel = lerp(state.vel, Math.max(-SPEED_MAX, Math.min(SPEED_MAX, state.T - T0w)), 0.2);   // ring speed, deg per frame
      if (Math.abs(vel) > 0.003 || Math.abs(state.vel) > 0.003) instancesDirty = true;
      state.vel = Math.abs(vel) > 0.003 ? vel : 0;
      const n = nearestPhoto(state.T), off = Math.abs(photos[n].t - state.T);
      const i = off <= FRONT_EDGE && !state.free && photos[n].yi === state.yearLock ? n : -1;
      setCurrent(i, state.T);
      const yi = yearAt(state.T);
      state.spin = -(((state.T % 360) + 360) % 360);

      // the light switch (the inner ring: photo lines ↔ heat colours), and the dive into a clicked photo
      const heat0 = state.heat;
      state.heat = Math.abs(state.heat - state.heatT) < 0.002 ? state.heatT : lerp(state.heat, state.heatT, SWITCH_SMOOTH);
      if (state.heat !== heat0) instancesDirty = true;           // heat lines stretch out with their day's weight
      U.uHeat.value = state.heat;
      if (heroCur.k < 0 && Math.abs(state.TT - state.T) < 1) state.dive = false;   // a dive survives the trip to its photo
      const stackT = state.stacks ? 1 : 0;                       // Stacks grow out of the ring, and fold back into it
      if (state.stack !== stackT) { state.stack = Math.abs(state.stack - stackT) < 0.002 ? stackT : lerp(state.stack, stackT, LIB.stackSmooth); instancesDirty = true; }
      const sv = state.stack * (1 - state.heat);                 // heat is colours only: no stacks
      if (Math.abs(sv - state.sv) > 1e-4) instancesDirty = true;
      state.sv = sv; tileHide.value = 1 - sv;
      meshes.forEach((m) => { m.visible = sv > 0.004; });
      state.diveT = lerp(state.diveT, state.dive ? 1 : 0, 0.08);

      state.gap = lerp(state.gap, state.gapT, SMOOTH * 0.9);
      state.yiS = lerp(state.yiS, yi, SMOOTH);
      const spread = (state.gap - GAP_COLLAPSED) / (GAP_EXPANDED - GAP_COLLAPSED);
      if (Math.abs(state.yiS - lastYiS) > 1e-4 || Math.abs(state.gap - lastGap) > 0.01) {
        for (let k = 0; k < YEARS.length; k++) yearYs[k] = yearY(k, state.yiS, spread);
        lastYiS = state.yiS; lastGap = state.gap; instancesDirty = true;
      }
      if (Math.abs(spread - state.spread) > 0.0005) { state.spread = spread; instancesDirty = true; }

      // camera
      const c = state.cam, t = state.camT, ov = state.mode === "overview";
      const face = ov ? 1 - spread : 0;                          // the overview looks down onto the library, nearly face-on
      const distT = lerp(ov ? lerp(t.dist, OVERVIEW_EXPANDED.dist * (isPhone() ? 1.15 : 1), spread) : t.dist, LIB.view.dist * (isPhone() ? 1.6 : 1), face);
      const tiltT = lerp(ov ? lerp(t.tilt, OVERVIEW_EXPANDED.tilt, spread) : t.tilt, LIB.view.tilt, face);
      const rollT = lerp(ov ? lerp(t.roll, OVERVIEW_EXPANDED.roll, spread) : t.roll, LIB.view.roll, face);
      c.dist = lerp(c.dist, distT, SMOOTH); c.tilt = lerp(c.tilt, tiltT, SMOOTH); c.roll = lerp(c.roll, rollT, SMOOTH);
      c.ox = lerp(c.ox, t.ox, SMOOTH); c.oy = lerp(c.oy, lerp(t.oy, LIB.view.oy, face), SMOOTH);
      const still = drag || phase !== "live" ? 0 : 1;            // the view leans toward the pointer, and kicks a little with speed
      state.yaw = lerp(state.yaw, state.yawT + ptr.x * PARALLAX.yaw * still, 0.12);
      state.pitch = lerp(state.pitch, state.pitchT + ptr.y * PARALLAX.pitch * still, 0.12);
      state.zoom = lerp(state.zoom, state.zoomT, 0.14);
      state.pan.x = lerp(state.pan.x, state.panT.x, 0.25); state.pan.y = lerp(state.pan.y, state.panT.y, 0.25);
      const off0 = Math.abs(state.yawT) < 0.5 && Math.abs(state.pitchT) < 0.5 && Math.abs(state.zoomT - 1) < 0.01 && Math.abs(state.panT.x) + Math.abs(state.panT.y) < 1;
      if (off0 !== resetOff) { resetOff = off0; $("#btnReset").setAttribute("aria-disabled", off0 ? "true" : "false"); }
      const focusZ = ov ? 0 : R + 60, midYear = state.yiS / 2;   // middle of the years on show (later ones are hidden)
      const fy = ov ? yearY(midYear, state.yiS, spread) * spread : 0, s = worldScale() * state.zoom;
      // The ring leans about the line through spring and fall, so winter sits higher (LIB.lean); the lean turns
      // with the ring. The focus view aims at where the front of the ring is once leaned.
      _rt.makeRotationY(WINTER_A * D).multiply(_q.makeRotationX(LIB.lean * D)).multiply(_q.makeRotationY(-WINTER_A * D));
      _rtInv.setFromRotationMatrix(_rt).invert();
      _fv.set(0, 0, focusZ).applyMatrix4(_q.makeRotationY(-state.spin * D)).applyMatrix4(_rt).applyMatrix4(_q.makeRotationY(state.spin * D));
      _w.copy(F).multiply(T3(c.ox * innerWidth + state.pan.x, c.oy * innerHeight + state.pan.y, 0)).multiply(SC(s, s, s)).multiply(T3(0, 0, -c.dist * (1 + Math.abs(state.vel) * 0.015)))
        .multiply(RZ(c.roll + state.vel * 0.5)).multiply(RX(c.tilt + state.pitch)).multiply(RY(state.yaw)).multiply(T3(-_fv.x, -fy - _fv.y, -_fv.z))
        .multiply(RY(state.spin)).multiply(_rt);
      world.matrix.copy(_w); world.matrixWorldNeedsUpdate = true;
      if (instancesDirty) writeInstances();
      placeGuides();

      // the photo at the front rises as it arrives and settles back as it leaves; the hovered photo pops forward
      const rise = Math.max(0, Math.min(1, 1 - (off - FRONT_FULL) / (FRONT_EDGE - FRONT_FULL)));
      state.stand = lerp(state.stand, i >= 0 ? rise : 0, SMOOTH * 1.6);
      heroHov.stand = lerp(heroHov.stand, state.hover >= 0 ? 1 : 0, 0.16);
      for (const h of heroes) {
        if (h.k < 0) continue;
        const p = photos[h.k], st = h === heroCur ? state.stand : heroHov.stand;
        const big = h === heroHov ? HOVER_SCALE : 0;
        cardMatrix(h.mesh.matrix, p, yearYs[p.yi], st, state.spread, big);
        const u = h.mesh.material.uniforms, gs = h.mesh.matrix.elements;
        u.uSize.value.set(Math.hypot(gs[0], gs[1], gs[2]), Math.hypot(gs[4], gs[5], gs[6]));
        u.shade.value = lerp(shadeOf(p), SHADE.current, Math.min(1, st * 1.4));
        u.uHide.value = state.heat;                              // heat is colours only: no photo lifts out of the ring
        h.mesh.material.depthTest = st < 0.3;                    // once raised, it sits in front of the ring (no cards slicing through)
        h.mesh.renderOrder = h === heroHov ? 12 : 11;
        h.mesh.matrixWorldNeedsUpdate = true;
      }
      // where the front photo is on screen: its corner radius (CORNER_PX), and its size while diving (DIVE.height)
      if (heroCur.k >= 0 && state.stand > 0.5) {
        heroCur.mesh.updateMatrixWorld();
        const e = heroCur.mesh.matrixWorld, a = _v1.set(-0.5, 0, 0).applyMatrix4(e).project(cam3), b = _v2.set(0.5, 0, 0).applyMatrix4(e).project(cam3);
        const screenW = Math.hypot((b.x - a.x) * innerWidth / 2, (b.y - a.y) * innerHeight / 2);
        if (screenW > 20) corner.value = lerp(corner.value, CORNER_PX * heroCur.mesh.material.uniforms.uSize.value.x / screenW, 0.2);
        const c0 = _v1.set(0, -0.5, 0).applyMatrix4(e).project(cam3), c1 = _v2.set(0, 0.5, 0).applyMatrix4(e).project(cam3);
        const screenH = Math.hypot((c1.x - c0.x) * innerWidth / 2, (c1.y - c0.y) * innerHeight / 2);
        if (state.dive && screenH > 4) state.diveK = Math.min(12, state.diveK * Math.pow(DIVE.height * innerHeight / screenH, 0.12));
      }
      if (!state.dive) state.diveK = lerp(state.diveK, 1, 0.1);
      placeMarks();
      const motion = Math.min(MOTION_BLUR_MAX, Math.abs(state.T - lastT) * MOTION_BLUR); lastT = state.T;
      post.uniforms.blur.value = lerp(post.uniforms.blur.value, EDGE_BLUR + motion, 0.25);
      post.uniforms.focus.value = state.diveT * DIVE.blur;
      // Order: the ring, then the front photo on top. While diving, the clicked photo is drawn after the blur, so only
      // what is behind it softens.
      const split = state.diveT > 0.01 && heroCur.k >= 0;
      const others = [...meshes, ...meshes.map((m) => m.userData.lines), ...guides], othersOn = others.map((m) => m.visible), heroOn = heroes.map((h) => h.mesh.visible);
      const show = (ring, front) => { others.forEach((m, k) => { m.visible = ring && othersOn[k]; }); heroes.forEach((h, k) => { h.mesh.visible = front && heroOn[k]; }); };
      renderer.autoClear = false;
      renderer.setRenderTarget(rt); renderer.clear();
      show(true, false); renderer.render(scene, cam3);
      show(false, true); if (split) heroCur.mesh.visible = false;
      renderer.render(scene, cam3);
      renderer.setRenderTarget(null); renderer.clear(); renderer.render(postScene, postCam);
      if (split) { show(false, false); heroCur.mesh.visible = heroOn[0]; renderer.clearDepth(); renderer.render(scene, cam3); }
      show(true, true);
      renderer.autoClear = true;
    }
    addEventListener("resize", () => { resize(); state.camT = { ...view(state.mode) }; });
    function setTheme(dark) {
      const th = dark ? THEME.dark : THEME.light;
      U.uBg.value.set(th.bg); U.uFg.value.set(th.fg); U.uDark.value = dark ? 1 : 0;
      clearBg.set(th.bg); renderer.setClearColor(clearBg, 1);
    }
    const clearBg = new THREE.Color();
    setTheme(isDark());

    // Start on the most recent year's heaviest day: the ring settles where attention was.
    const lastYear = YEARS.length - 1;
    let startIdx = Math.max(0, photos.findIndex((p) => p.yi === lastYear)), bestN = 0;
    for (let k = 0; k < N; k++) {
      if (photos[k].yi !== lastYear || (k > 0 && dayOf(k - 1) === dayOf(k))) continue;
      const n = counted.get(photos[k].dk) || 0;
      if (n >= bestN) { bestN = n; startIdx = k; }               // ties go to the more recent day
    }
    state.TT = state.T = lastT = photos[startIdx].t; state.yearLock = photos[startIdx].yi;
    for (let k = 0; k < YEARS.length; k++) yearYs[k] = yearY(k, yearAt(state.T), 0);
    state.yiS = yearAt(state.T);
    setCurrent(startIdx, state.T);
    requestAnimationFrame(frame);

    window.__yearloop = { state, photos, setExpanded, setMode, setHeat, goTo, nVideo, nScale, get phase() { return phase; },
                          setStacks, get atlasesLoaded() { return atlasesLoaded; }, local: LOCAL };   // for testing
    return {
      enter() {                                    // the ring spins in within the starting year, seen from above
        state.started = true;
        marks.classList.add("in");
        state.camT = { ...view(state.mode) };
        const within = yearAt(state.TT + 140) === yearAt(state.TT);
        state.T = state.TT + (within ? 140 : -140); state.cam.dist = isPhone() ? 6500 : 4200; state.cam.tilt = -70;
        setMode("overview");
      },
      setTheme
    };
  }

})();
