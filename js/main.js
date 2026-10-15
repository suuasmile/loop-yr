/* Loopyear — main script
   Photos on a twelve-month ring, one ring per year. Scroll turns the ring; one turn is one year.

   Works two ways:
   - opened straight from the folder (file://): Chrome will not hand local images or videos to WebGL, so the
     photos are read from media-js/ (the same files wrapped as scripts) and turned into in-page blobs;
   - served from a web host (https://): the plain files in media/ are used.
   Load order (index.html): js/three.min.js, js/data.js (the photo list), then this file. */
(function () {
  "use strict";

  // ---------- Tunables (the feel lives here; same values as the prototype and the PRD) ----------
  const R = 900;               // ring radius, px
  const CARD_L = 300;          // base long edge of a card, px
  // Collapsed, each year is a real donut: cards sit around a tube of radius TUBE_R, placed by time of day
  // (TUBE_MID is noon; 0 = the outer wall, 90 = the top, 180 = the inner wall), so the ring has body instead of lying flat.
  const TUBE_R = 170;          // radius of the donut's tube, px
  const TUBE_MID = 95;         // where noon sits on the tube (deg)
  const TUBE_SPREAD = 75;      // how far around the tube the day spreads either side of noon (deg)
  const LEAN_EXPANDED = 30;    // resting lean once the years are pulled apart (the tube flattens into a cylinder wall)
  const CORNER_PX = 10;        // rounded photo corners, in screen px on the photo at the front
  const FLEX = 1.4;            // while turning, cards swing back this many degrees per degree-per-frame of speed …
  const SWELL = 7;             // … and the donut swells outward this many px per degree-per-frame
  const SPEED_MAX = 14;        // speed (deg per frame) beyond which nothing grows further
  const PARALLAX = { yaw: 3, pitch: 2 };   // the view leans toward the pointer by up to this much (deg)
  const OVERVIEW_EXPANDED = { dist: 6600, tilt: -18, roll: -10 };
  const STAND_SCALE = 1.9;     // growth of the front card (focus view)
  const OVERVIEW_SCALE = 1.3;  // growth of the front card (Homescreen / overview)
  const HOVER_SCALE = 1.5;     // growth of a hovered card
  const LEVEL = 0.85;          // how much of the camera roll a raised card cancels
  const INTRO_TOTAL = 5000;    // ms from the first scroll until the instructions are gone
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
  const VIGNETTE = 0.9;        // how dark the screen edges get (0 = none, 1 = black)
  const EDGE_BLUR = 0.012;     // streak length at the screen edge while the ring is still (fraction of the screen)
  const MOTION_BLUR = 0.004;   // extra streak per degree the ring turns in a frame …
  const MOTION_BLUR_MAX = 0.05;  // … up to this much
  const WHEEL_DEG = 0.14;      // ring turn per px of wheel / two-finger scroll
  const TOUCH_DEG = 0.3;       // ring turn per px of one-finger swipe
  const FLING_MS = 220, FLING_MAX = 120;   // a flick carries on for about this much of its speed (ms), at most this many degrees
  const TWO_FINGER_YAW = 0.3, TWO_FINGER_TILT = 0.15;   // view change per px of two-finger movement
  const ZOOM_MIN = 0.6, ZOOM_MAX = 2.4;    // pinch / trackpad zoom range
  const FRONT_FULL = 8;        // within this many degrees of the front a photo is fully raised
  const FRONT_EDGE = 24;       // beyond this it rests in the ring
  const SHADE = { current: 1, near: 0.92, year: 0.8 };
  const PAST = { start: 0.6, step: 0.7, min: 0.1 };   // past years in black and white: brightness of the year below, × step per year further back

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
    introTimer = setTimeout(enter, INTRO_TOTAL - INTRO_FADE);   // … fading out so they are gone at 5 s
  }
  function enter() {
    if (phase !== "intro") return;
    clearTimeout(introTimer);
    phase = "live";
    intro.classList.remove("show");
    $("#ui").classList.add("in");                  // header, year column and info button rise in
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
    if ((phase === "intro" || phase === "help") && !e.repeat && ["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); skip(); }
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
    const photos = manifest.items.map((it) => {
      const date = parseLocal(it.d), yi = YEARS.indexOf(date.getFullYear());
      const lift = rnd(), jitter = rnd() - 0.5, scatter = rnd() - 0.5;
      const L = CARD_L * (0.86 + lift * 0.28), ar = it.w / it.h;
      const cw = ar >= 1 ? L : L * ar, ch = ar >= 1 ? L / ar : L;
      const minutes = date.getHours() * 60 + date.getMinutes();
      const angle = (dayOfYear(date) + minutes / 1440) / daysIn(date.getFullYear()) * 360;   // Jan 1 = front; a day's photos sit apart in time order
      const dayPart = (date.getHours() * 60 + date.getMinutes()) / 1440 - 0.5;   // -0.5 midnight … 0 noon … 0.5 midnight
      const around = Math.max(-1, Math.min(1, dayPart * 1.6 + scatter * 0.7));  // time of day, loosened so a busy hour does not stack up
      return { ...it, date, yi, angle, t: yi * 360 + angle, radial: R + lift * 70, spin: jitter * 14, cw, ch, phi: TUBE_MID + around * TUBE_SPREAD };
    });
    const N = photos.length;
    const nVideo = photos.filter((p) => p.v).length;

    const T_MAX = YEARS.length * 360 - 0.001;
    const yearAt = (T) => Math.max(0, Math.min(YEARS.length - 1, Math.floor(T / 360)));
    const dateAtT = (T) => { const k = yearAt(T); return new Date(YEARS[k], 0, 1 + Math.round((T - k * 360) / 360 * 365)); };
    function nearestPhoto(T) {                      // photos are in date order, so in T order too
      let lo = 0, hi = N - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (photos[mid].t < T) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(photos[lo - 1].t - T) <= Math.abs(photos[lo].t - T)) lo--;
      return lo;
    }

    // ---------- WebGL ----------
    const canvas = $("#gl");
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch (e) { return fail("This browser cannot draw the 3D ring (WebGL is off or unsupported). Try Chrome, Safari or Edge."); }
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const isGL2 = renderer.capabilities.isWebGL2;
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const scene = new THREE.Scene();
    const cam3 = new THREE.PerspectiveCamera(45, 1, 5, 400000);
    // The scene is built in CSS space (x right, y down, z toward the viewer), exactly as the prototype's
    // transforms; one flip of y at the root turns it into WebGL space. Same numbers, same picture.
    const world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);
    // The ring is drawn off screen first, then once more through a pass that darkens and streaks the edges,
    // so photos leaving the screen fade into the black and smear outward, more while the ring is turning.
    // stencilBuffer: in r128 that is what gets a 24-bit depth buffer; with the 16-bit default, piled years only 18 px apart flicker through each other
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: true };
    const rt = isGL2 && THREE.WebGLMultisampleRenderTarget ? Object.assign(new THREE.WebGLMultisampleRenderTarget(1, 1, rtOpts), { samples: 4 })
                                                           : new THREE.WebGLRenderTarget(1, 1, rtOpts);
    const post = new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture }, aspect: { value: 1 }, blur: { value: EDGE_BLUR }, vignette: { value: VIGNETTE } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D map; uniform float aspect, blur, vignette; varying vec2 vUv;
        void main() {
          vec2 d = vUv - 0.5; d.x *= aspect;
          float r = length(d) / length(vec2(0.5 * aspect, 0.5));       // 0 at the centre, 1 in the corners
          float edge = smoothstep(0.35, 1.0, r);
          vec2 dir = (vUv - 0.5) * blur * edge * edge / 11.0;          // streak outward from the centre
          vec3 c = vec3(0.0);
          for (int i = 0; i < 12; i++) c += texture2D(map, vUv - dir * float(i)).rgb;
          c /= 12.0;
          gl_FragColor = vec4(c * (1.0 - vignette * smoothstep(0.45, 1.05, r)), 1.0);
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
    const geo = new THREE.PlaneGeometry(1, 1, 12, 1);   // split across its width so it can bend along the ring
    const corner = { value: 12 };                       // corner radius in card units, shared by every card; set from CORNER_PX each frame
    const FRAG = `
      uniform sampler2D map; uniform float uCorner;
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey;
      void main() {
        float r = min(uCorner, 0.5 * min(vSize.x, vSize.y));
        vec2 q = abs((vLoc - 0.5) * vSize) - (0.5 * vSize - r);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;      // distance outside the rounded rectangle
        float alpha = clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
        if (alpha <= 0.0) discard;
        vec3 c = texture2D(map, vUv).rgb;
        c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), vGrey);   // past years in black and white
        gl_FragColor = vec4(c * vShade, alpha);          // fading toward the black stage stands in for opacity
      }`;
    // Bend a card around the ring: k is the curvature (1 / radius) across the card's width, in world px.
    const BEND = `
      vec3 bend(vec3 p, float w, float k) {
        if (abs(k) < 1e-6) return p;
        float a = p.x * w * k;
        return vec3(sin(a) / k / w, p.y, p.z + (cos(a) - 1.0) / k);
      }`;
    const VERT_INST = `
      attribute vec4 aUv; attribute float aShade; attribute float aGrey; attribute float aBend;
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey;
      ${BEND}
      void main() {
        vShade = aShade; vGrey = aGrey; vLoc = uv;
        vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        vUv = vec2(aUv.x + uv.x * aUv.z, 1.0 - (aUv.y + uv.y * aUv.w));
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(bend(position, vSize.x, aBend), 1.0);
      }`;
    const VERT_HERO = `
      uniform vec4 uvRect; uniform float shade; uniform vec2 uSize; uniform float uBend;
      varying vec2 vUv; varying vec2 vLoc; varying vec2 vSize; varying float vShade; varying float vGrey;
      ${BEND}
      void main() {
        vShade = shade; vGrey = 0.0; vLoc = uv; vSize = uSize;   // raised cards are always from the selected year
        vUv = vec2(uvRect.x + uv.x * uvRect.z, 1.0 - (uvRect.y + uv.y * uvRect.w));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(bend(position, uSize.x, uBend), 1.0);
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

    // One instanced mesh per atlas: ~144 cards each, one draw call each.
    const A = manifest.atlas.size;
    const atlasTex = manifest.atlas.files.map(() => grey);
    const meshes = manifest.atlas.files.map((_, ai) => {
      const members = photos.map((p, k) => k).filter((k) => photos[k].a[0] === ai);
      const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: grey }, uCorner: corner }, vertexShader: VERT_INST, fragmentShader: FRAG,
        side: THREE.DoubleSide, extensions: { derivatives: true }, alphaToCoverage: true });   // rounded corners stay smooth under MSAA
      const mesh = new THREE.InstancedMesh(geo, mat, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array(members.length * 4), shade = new Float32Array(members.length), bw = new Float32Array(members.length), bendK = new Float32Array(members.length);
      members.forEach((k, j) => {
        const a = photos[k].a; photos[k].mi = ai; photos[k].ii = j;
        uv.set([a[1] / A, a[2] / A, a[3] / A, a[4] / A], j * 4); shade[j] = SHADE.year;
      });
      mesh.geometry = geo.clone();
      mesh.geometry.setAttribute("aUv", new THREE.InstancedBufferAttribute(uv, 4));
      mesh.geometry.setAttribute("aShade", new THREE.InstancedBufferAttribute(shade, 1));
      mesh.geometry.setAttribute("aGrey", new THREE.InstancedBufferAttribute(bw, 1));
      mesh.geometry.setAttribute("aBend", new THREE.InstancedBufferAttribute(bendK, 1).setUsage(THREE.DynamicDrawUsage));
      mesh.frustumCulled = false; mesh.userData.members = members;
      world.add(mesh);
      return mesh;
    });
    let atlasesLoaded = 0;
    manifest.atlas.files.forEach((f, ai) => album.atlas(ai).then((src) => loadTexture(src, (tex) => {
      if (!tex) return;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = maxAniso;
      atlasTex[ai] = tex; meshes[ai].material.uniforms.map.value = tex; atlasesLoaded++;
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
      const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: grey }, uvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, shade: { value: 1 },
                     uCorner: corner, uSize: { value: new THREE.Vector2(1, 1) }, uBend: { value: 0 } },
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
    // Where a card rests: around the donut's tube while collapsed, flattening into a cylinder wall as the years spread.
    const restPhi = (p, spread) => p.phi * (1 - spread) + LEAN_EXPANDED * spread;
    const restTube = (spread) => TUBE_R * (1 - spread) + Math.abs(state.vel) * SWELL * 0.5;
    function bendOf(p, spread) {                   // curvature of the ring across the card, as the card sits on the tube
      const c = Math.cos(restPhi(p, spread) * D);
      return c / (p.radial + restTube(spread) * c);
    }
    function cardMatrix(out, p, y, stand, spread, big) {
      const phi = restPhi(p, spread), tube = restTube(spread), swing = -state.vel * FLEX;   // cards trail as the ring turns
      out.identity().multiply(T3(0, y, 0)).multiply(RY(p.angle)).multiply(T3(0, 0, p.radial + Math.abs(state.vel) * SWELL));
      if (!stand) return out.multiply(RX(phi)).multiply(T3(0, 0, tube)).multiply(RY(swing)).multiply(RZ(p.spin)).multiply(SC(p.cw, p.ch, 1));
      const facing = -(state.cam.tilt + state.pitch), turn = -(p.angle + state.spin + state.yaw), level = -state.cam.roll * LEVEL;
      const s = 1 + ((big || (state.mode === "overview" ? OVERVIEW_SCALE : STAND_SCALE)) - 1) * stand;
      return out.multiply(RY(turn * stand)).multiply(RX(phi * (1 - stand) + facing * stand)).multiply(T3(0, 0, tube * (1 - stand) + 160 * stand))
        .multiply(RY(swing * (1 - stand))).multiply(RZ(p.spin * (1 - stand) + level * stand)).multiply(SC(s * p.cw, s * p.ch, 1));
    }
    const hidden = new Set();
    let instancesDirty = true;
    function hideInstance(k, on) { if (on) hidden.add(k); else hidden.delete(k); instancesDirty = true; }
    const yearYs = new Float32Array(YEARS.length);
    let shownYi = -1;                                // the selected year; every later year is hidden
    function writeInstances() {
      for (const mesh of meshes) {
        const arr = mesh.instanceMatrix.array, members = mesh.userData.members, bendAttr = mesh.geometry.getAttribute("aBend");
        for (let j = 0; j < members.length; j++) {
          const k = members[j];
          (hidden.has(k) || photos[k].yi > shownYi ? ZERO : cardMatrix(_m, photos[k], yearYs[photos[k].yi], 0, state.spread)).toArray(arr, j * 16);
          bendAttr.array[j] = bendOf(photos[k], state.spread);
        }
        mesh.instanceMatrix.needsUpdate = bendAttr.needsUpdate = true;
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
          attr.array[j] = back <= 0 ? (cur >= 0 && Math.abs(k - cur) <= 3 ? SHADE.near : SHADE.year)
                                    : Math.max(PAST.min, PAST.start * Math.pow(PAST.step, back - 1));
          greyAttr.array[j] = back > 0 ? 1 : 0;
        }
        attr.needsUpdate = greyAttr.needsUpdate = true;
      }
    }

    // ---------- Header: date fields, year column ----------
    const msel = $("#msel"), dsel = $("#dsel");
    for (let m = 1; m <= 12; m++) msel.add(new Option(pad(m), m));
    for (let d = 1; d <= 31; d++) dsel.add(new Option(pad(d), d));
    function jumpToDate() {
      const want = new Date(YEARS[yearAt(state.TT)], +msel.value - 1, +dsel.value);
      let best = 0, bestD = Infinity;
      photos.forEach((p, i) => { const dd = Math.abs(p.date - want); if (dd < bestD) { bestD = dd; best = i; } });
      goTo(best);
    }
    [msel, dsel].forEach((s) => s.addEventListener("change", jumpToDate));
    function goToYear(k) {
      if (k < 0 || k >= YEARS.length) return;
      const i = photos.findIndex((p) => p.yi === k); if (i >= 0) goTo(i);
    }
    $("#yNext").addEventListener("click", () => goToYear(yearAt(state.TT) + 1));
    $("#yPrev").addEventListener("click", () => goToYear(yearAt(state.TT) - 1));
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
    // picking one brings it to the front.
    const tsel = $("#tsel"), timeField = $("#timeField");
    const dayOf = (i) => photos[i].d.slice(0, 10);
    const clock = (d) => `${pad(((d.getHours() + 11) % 12) + 1)}:${pad(d.getMinutes())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
    let timesKey = "";
    function updateTimes(i) {
      if (i < 0) { if (timesKey) { timesKey = ""; tsel.textContent = ""; tsel.disabled = true; timeField.classList.remove("multi"); } return; }
      let a = i, b = i;
      while (a > 0 && dayOf(a - 1) === dayOf(i)) a--;
      while (b < N - 1 && dayOf(b + 1) === dayOf(i)) b++;
      const key = a + ":" + b;
      if (key !== timesKey) {
        timesKey = key; tsel.textContent = "";
        for (let k = a; k <= b; k++) tsel.add(new Option(`${clock(photos[k].date)}  (${k - a + 1} of ${b - a + 1})`, k));
        tsel.disabled = a === b; timeField.classList.toggle("multi", a < b);
        tsel.setAttribute("aria-label", a < b ? `Photo time: ${b - a + 1} photos on this day` : "Photo time");
      }
      tsel.value = i;
    }
    tsel.addEventListener("change", () => { goTo(+tsel.value); tsel.blur(); });

    // ---------- State ----------
    const state = {
      T: 0, TT: 0, spin: 0,
      gap: GAP_COLLAPSED, gapT: GAP_COLLAPSED, expanded: false,
      mode: "focus", cam: { ...view("focus") }, camT: { ...view("focus") },
      yaw: 0, yawT: 0, pitch: 0, pitchT: 0, zoom: 1, zoomT: 1,
      hover: -1, stand: 0, yiS: 0, spread: 0, vel: 0, current: -1, started: false
    };
    function setMode(mode) { state.mode = mode; state.camT = { ...view(mode) }; $("#btnView").setAttribute("aria-pressed", mode === "overview" ? "true" : "false"); }
    function setExpanded(on) { state.expanded = on; state.gapT = on ? GAP_EXPANDED : GAP_COLLAPSED; $("#btnExpand").setAttribute("aria-pressed", on ? "true" : "false"); }
    function goTo(i) { i = Math.max(0, Math.min(N - 1, i)); state.TT = photos[i].t; if (state.mode === "overview") setMode("focus"); }
    function turn(deg) { state.TT = Math.max(0, Math.min(T_MAX, state.TT + deg)); if (state.mode === "overview") setMode("focus"); }
    const setZoom = (z) => { state.zoomT = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); };

    // ---------- Input (only while the ring is live; the opening has its own handlers above) ----------
    // Desktop: wheel / two-finger scroll turns the ring; trackpad pinch zooms (Chrome/Edge/Firefox send it as ctrl + wheel).
    addEventListener("wheel", (e) => {
      if (phase !== "live") return;
      e.preventDefault();
      if (e.ctrlKey) { setZoom(state.zoomT * Math.exp(-e.deltaY * 0.01)); return; }
      turn((e.deltaY + e.deltaX) * (e.deltaMode === 1 ? 16 : 1) * WHEEL_DEG);
    }, { passive: false });

    // Phone: ONE finger only turns the ring (time). TWO fingers only change the view: move them together to tilt
    // and orbit, pinch to zoom. A gesture keeps the mode it started in until every finger is lifted, so the two never
    // blend (lifting one finger of a pinch does not suddenly start turning the ring). Expanded view is the button only.
    const touch = { mode: null, multi: false, x: 0, y: 0, axis: null, v: 0, t: 0, d0: 1, z0: 1, mx: 0, my: 0 };
    const two = (e) => { const a = e.touches[0], b = e.touches[1];
      return { d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; };
    addEventListener("touchstart", (e) => {
      if (phase !== "live" || e.target.closest("#header, #years, #infoWrap")) return;   // date fields, buttons, year list keep their taps
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
        state.yawT += (g.x - touch.mx) * TWO_FINGER_YAW;
        state.pitchT = Math.max(-45, Math.min(40, state.pitchT + (g.y - touch.my) * TWO_FINGER_TILT));
        setZoom(touch.z0 * g.d / touch.d0);
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
    document.addEventListener("gesturechange", (e) => { e.preventDefault(); if (!touch.mode && phase === "live") setZoom(gestureZoom0 * e.scale); });

    // Picking: which card is under the pointer (the raised cards first, then the ring).
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function pick(cx, cy) {
      ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, cam3);
      const heroHits = raycaster.intersectObjects(heroes.filter((h) => h.k >= 0).map((h) => h.mesh), false);
      if (heroHits.length) return heroes.find((h) => h.mesh === heroHits[0].object).k;
      const hits = raycaster.intersectObjects(meshes, false);
      for (const hit of hits) { const k = hit.object.userData.members[hit.instanceId]; if (!hidden.has(k) && photos[k].yi === shownYi) return k; }
      return -1;                                                 // only the selected year answers the pointer
    }
    let drag = null, hoverQueued = null;
    const stage = $("#stage");
    stage.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw0: state.yawT, pitch0: state.pitchT, moved: false, touch: e.pointerType === "touch" };
    });
    addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.touch || phase !== "live") return;
        if (drag.moved) { stage.classList.add("dragging"); setHover(-1); }
        state.yawT = drag.yaw0 + dx * 0.2;
        state.pitchT = Math.max(-45, Math.min(40, drag.pitch0 + dy * 0.12));
        return;
      }
      if (e.pointerType === "mouse") { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; }
      if (e.pointerType === "mouse" && phase === "live") hoverQueued = [e.clientX, e.clientY];
    });
    addEventListener("pointerup", (e) => {
      if (!drag) return;
      const moved = drag.moved, afterTwoFingers = drag.touch && touch.multi; drag = null; stage.classList.remove("dragging");
      if (afterTwoFingers) return;                               // lifting fingers after a two-finger gesture is not a tap
      if (!moved && phase === "live" && e.target.closest("#stage")) { const k = pick(e.clientX, e.clientY); if (k >= 0) { setHover(-1); goTo(k); } }
    });
    stage.addEventListener("pointerleave", () => { hoverQueued = null; setHover(-1); });
    function setHover(k) {
      if (k === state.current) k = -1;
      if (k === state.hover) return;
      state.hover = k; heroHov.set(k); heroHov.stand = 0;
      stage.classList.toggle("over-card", k >= 0);
    }
    function resetView() { state.yawT = 0; state.pitchT = 0; state.zoomT = 1; }
    $("#btnReset").addEventListener("click", resetView);
    addEventListener("keydown", (e) => {
      if (phase !== "live" || e.target.tagName === "SELECT") return;
      const base = state.current >= 0 ? state.current : nearestPhoto(state.T);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") goTo(base + (state.current >= 0 || photos[base].t < state.T ? 1 : 0));
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") goTo(base - (state.current >= 0 || photos[base].t > state.T ? 1 : 0));
      if (e.key === "e" || e.key === "E") setExpanded(!state.expanded);
      if (e.key === "o" || e.key === "O") setMode(state.mode === "overview" ? "focus" : "overview");
      if (e.key === "r" || e.key === "R") resetView();
      if (e.key === "=" || e.key === "+") setZoom(state.zoomT * 1.15);
      if (e.key === "-" || e.key === "_") setZoom(state.zoomT / 1.15);
    });
    $("#btnView").addEventListener("click", () => setMode(state.mode === "overview" ? "focus" : "overview"));
    $("#btnExpand").addEventListener("click", () => setExpanded(!state.expanded));
    ["wheel", "pointerdown", "pointermove", "pointerup"].forEach((t) => $("#ui").addEventListener(t, (e) => { if (e.target.closest("#header, #years, #infoWrap")) e.stopPropagation(); }));

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
    let lastYiS = -1, lastGap = -1, resetOff = null, lastT = 0;
    const ptr = { x: 0, y: 0 }, _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
    function frame() {
      requestAnimationFrame(frame);
      if (hoverQueued && !drag) { const [x, y] = hoverQueued; hoverQueued = null; setHover(pick(x, y)); }

      const T0 = state.T;
      state.T = lerp(state.T, state.TT, SMOOTH * 1.3);
      const vel = lerp(state.vel, Math.max(-SPEED_MAX, Math.min(SPEED_MAX, state.T - T0)), 0.2);   // ring speed, deg per frame
      if (Math.abs(vel) > 0.003 || Math.abs(state.vel) > 0.003) instancesDirty = true;
      state.vel = Math.abs(vel) > 0.003 ? vel : 0;
      const n = nearestPhoto(state.T), off = Math.abs(photos[n].t - state.T);
      const i = off <= FRONT_EDGE ? n : -1;
      setCurrent(i, state.T);
      const yi = yearAt(state.T);
      state.spin = -(((state.T % 360) + 360) % 360);

      state.gap = lerp(state.gap, state.gapT, SMOOTH * 0.9);
      state.yiS = lerp(state.yiS, yi, SMOOTH);
      const spread = (state.gap - GAP_COLLAPSED) / (GAP_EXPANDED - GAP_COLLAPSED);
      if (Math.abs(state.yiS - lastYiS) > 1e-4 || Math.abs(state.gap - lastGap) > 0.01) {
        for (let k = 0; k < YEARS.length; k++) yearYs[k] = yearY(k, state.yiS, spread);
        lastYiS = state.yiS; lastGap = state.gap; instancesDirty = true;
      }
      if (Math.abs(spread - state.spread) > 0.0005) { state.spread = spread; instancesDirty = true; }
      if (instancesDirty) writeInstances();

      // camera
      const c = state.cam, t = state.camT, ov = state.mode === "overview";
      const distT = ov ? lerp(t.dist, OVERVIEW_EXPANDED.dist * (isPhone() ? 1.15 : 1), spread) : t.dist;
      const tiltT = ov ? lerp(t.tilt, OVERVIEW_EXPANDED.tilt, spread) : t.tilt;
      const rollT = ov ? lerp(t.roll, OVERVIEW_EXPANDED.roll, spread) : t.roll;
      c.dist = lerp(c.dist, distT, SMOOTH); c.tilt = lerp(c.tilt, tiltT, SMOOTH); c.roll = lerp(c.roll, rollT, SMOOTH);
      c.ox = lerp(c.ox, t.ox, SMOOTH); c.oy = lerp(c.oy, t.oy, SMOOTH);
      const still = drag || phase !== "live" ? 0 : 1;            // the view leans toward the pointer, and kicks a little with speed
      state.yaw = lerp(state.yaw, state.yawT + ptr.x * PARALLAX.yaw * still, 0.12);
      state.pitch = lerp(state.pitch, state.pitchT + ptr.y * PARALLAX.pitch * still, 0.12);
      state.zoom = lerp(state.zoom, state.zoomT, 0.14);
      const off0 = Math.abs(state.yawT) < 0.5 && Math.abs(state.pitchT) < 0.5 && Math.abs(state.zoomT - 1) < 0.01;
      if (off0 !== resetOff) { resetOff = off0; $("#btnReset").setAttribute("aria-disabled", off0 ? "true" : "false"); }
      const focusZ = ov ? 0 : R + 60, midYear = state.yiS / 2;   // middle of the years on show (later ones are hidden)
      const fy = ov ? yearY(midYear, state.yiS, spread) * spread : 0, s = worldScale() * state.zoom;
      _w.copy(F).multiply(T3(c.ox * innerWidth, c.oy * innerHeight, 0)).multiply(SC(s, s, s)).multiply(T3(0, 0, -c.dist * (1 + Math.abs(state.vel) * 0.015)))
        .multiply(RZ(c.roll + state.vel * 0.5)).multiply(RX(c.tilt + state.pitch)).multiply(RY(state.yaw)).multiply(T3(0, -fy, -focusZ)).multiply(RY(state.spin));
      world.matrix.copy(_w); world.matrixWorldNeedsUpdate = true;

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
        u.uBend.value = bendOf(p, state.spread) * (1 - st);        // flattens as it rises to face you
        h.mesh.material.uniforms.shade.value = lerp(SHADE.year, SHADE.current, Math.min(1, st * 1.4));
        h.mesh.material.depthTest = st < 0.3;                    // once raised, it sits in front of the ring (no cards slicing through)
        h.mesh.renderOrder = h === heroHov ? 12 : 11;
        h.mesh.matrixWorldNeedsUpdate = true;
      }
      // corner radius in card units, so the photo at the front shows CORNER_PX on screen (the ring's cards share it)
      if (heroCur.k >= 0 && state.stand > 0.5) {
        const e = heroCur.mesh.matrixWorld, px = _v1.set(-0.5, 0, 0).applyMatrix4(e).project(cam3).x, qx = _v2.set(0.5, 0, 0).applyMatrix4(e).project(cam3).x;
        const screenW = Math.abs(qx - px) * innerWidth / 2;
        if (screenW > 20) corner.value = lerp(corner.value, CORNER_PX * heroCur.mesh.material.uniforms.uSize.value.x / screenW, 0.2);
      }
      const motion = Math.min(MOTION_BLUR_MAX, Math.abs(state.T - lastT) * MOTION_BLUR); lastT = state.T;
      post.uniforms.blur.value = lerp(post.uniforms.blur.value, EDGE_BLUR + motion, 0.25);
      renderer.setRenderTarget(rt); renderer.render(scene, cam3);
      renderer.setRenderTarget(null); renderer.render(postScene, postCam);
    }
    addEventListener("resize", () => { resize(); state.camT = { ...view(state.mode) }; });

    // Start on the most recent year, as the Homescreen shows.
    const startIdx = Math.max(0, photos.findIndex((p) => p.yi === YEARS.length - 1));
    state.TT = state.T = lastT = photos[startIdx].t;
    for (let k = 0; k < YEARS.length; k++) yearYs[k] = yearY(k, yearAt(state.T), 0);
    state.yiS = yearAt(state.T);
    setCurrent(startIdx, state.T);
    requestAnimationFrame(frame);

    window.__yearloop = { state, photos, setExpanded, setMode, goTo, nVideo, get phase() { return phase; },
                          get atlasesLoaded() { return atlasesLoaded; }, local: LOCAL };   // for testing
    return {
      enter() {                                    // the ring spins in within the starting year, seen from above
        state.started = true;
        state.camT = { ...view(state.mode) };
        const within = yearAt(state.TT + 140) === yearAt(state.TT);
        state.T = state.TT + (within ? 140 : -140); state.cam.dist = isPhone() ? 6500 : 4200; state.cam.tilt = -70;
        setMode("overview");
      }
    };
  }

})();
