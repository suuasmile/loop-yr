/* loop-yr — reads a visitor's own photos, entirely in the browser (nothing is uploaded or stored)
   YL_INGEST.read(files, onProgress) → Promise of an album the ring can show, shaped like js/data.js:
     { manifest: { years, atlas, sheet, items }, atlas(i), sheet(i), clip(key), skipped }
     (an item whose date was only estimated carries e: 1, so the ring leaves it out of the day counts)
   - capture dates: EXIF (exifr) for photos, the QuickTime header for videos, then the file name, then the file's
     modified date;
   - a Live Photo (IMG_n.HEIC + IMG_n.MOV) becomes one photo with its motion as the clip;
   - every photo is decoded once, in date order: an 800 px copy is kept (JPEG, in memory) and a 156 px thumbnail is
     drawn into 2048 px atlases, the same layout tools/pack.py makes, so the ring code does not care where photos came from;
   - HEIC that the browser cannot decode (Chrome, Firefox) goes through heic2any, loaded only when first needed. */
(function () {
  "use strict";
  const ATLAS = 2048, CELL = 160, PAD = 2, THUMB = 156, MED = 800, SHEET = 1600;
  const PER_ROW = ATLAS / CELL, PER_ATLAS = PER_ROW * PER_ROW;
  const PHOTO = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?)$/i, VIDEO = /\.(mov|mp4|m4v|webm|3gp)$/i;
  const HEIC = /\.(heic|heif)$/i;
  const CONCURRENCY = 3;

  const kindOf = (f) => (f.type.startsWith("video/") || VIDEO.test(f.name)) ? "video"
                      : (f.type.startsWith("image/") || PHOTO.test(f.name)) ? "photo" : null;
  const stem = (name) => name.replace(/\.[^.]+$/, "").replace(/\(\d+\)$|_$/, "").trim().toUpperCase();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const valid = (d) => d instanceof Date && !isNaN(d) && d.getFullYear() > 1900 && d.getFullYear() <= new Date().getFullYear() + 1;

  // ---------- capture dates ----------
  function nameDate(name) {                        // IMG_20230914_153012, 2023-09-14 15.30.12, PXL_20230914_…, 20230914_153012
    const m = name.match(/(\d{4})[-_.]?(\d\d)[-_.]?(\d\d)[ _T-]?(\d\d)[.:_-]?(\d\d)[.:_-]?(\d\d)/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return valid(d) && +m[2] >= 1 && +m[2] <= 12 ? d : null;
  }
  async function videoDate(file) {                 // creation time in the QuickTime / MP4 "mvhd" box (UTC, shown in local time)
    let off = 0;
    for (let guard = 0; off + 8 <= file.size && guard < 64; guard++) {
      const h = new DataView(await file.slice(off, off + 16).arrayBuffer());
      let len = h.getUint32(0), hdr = 8;
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (len === 1) { len = Number(h.getBigUint64(8)); hdr = 16; } else if (len === 0) len = file.size - off;
      if (len < 8) return null;
      if (type === "moov") {
        const b = new Uint8Array(await file.slice(off + hdr, off + Math.min(len, 8 << 20)).arrayBuffer());
        for (let i = 4; i + 24 < b.length; i++) {
          if (b[i] === 0x6d && b[i + 1] === 0x76 && b[i + 2] === 0x68 && b[i + 3] === 0x64) {   // "mvhd"
            const v = new DataView(b.buffer, i + 4);
            const secs = v.getUint8(0) === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
            const d = new Date((secs - 2082844800) * 1000);                                  // 1904 → 1970
            return secs > 0 && valid(d) ? d : null;
          }
        }
        return null;
      }
      off += len;
    }
    return null;
  }
  async function captureDate(item) {
    const f = item.file;
    let d = null;
    try {
      if (item.kind === "photo" && window.exifr) {
        const x = await window.exifr.parse(f, { tiff: false, exif: ["DateTimeOriginal", "CreateDate"] });   // "pick" breaks in exifr's lite build
        d = x && (x.DateTimeOriginal || x.CreateDate);
      } else if (item.kind === "video") d = await videoDate(f);
    } catch (e) { d = null; }
    if (valid(d)) return { date: d, estimated: false };
    d = nameDate(f.name);
    if (d) return { date: d, estimated: false };
    return { date: new Date(f.lastModified), estimated: true };   // last resort; marked so it can be counted
  }

  // ---------- decoding ----------
  let heicLib = null;
  function loadHeic() {                            // ~1.3 MB, so it only loads when a HEIC needs it
    if (!heicLib) heicLib = new Promise((res, rej) => {
      if (window.heic2any) return res(window.heic2any);
      const s = document.createElement("script");
      s.src = "js/vendor/heic2any.min.js";
      s.onload = () => window.heic2any ? res(window.heic2any) : rej(new Error("heic2any missing"));
      s.onerror = () => rej(new Error("heic2any did not load"));
      document.head.appendChild(s);
    });
    return heicLib;
  }
  async function bitmapOf(file) {
    try { return await createImageBitmap(file); }
    catch (e) {
      if (!HEIC.test(file.name) && !/hei[cf]/i.test(file.type)) throw e;
      const conv = await (await loadHeic())({ blob: file, toType: "image/jpeg", quality: 0.9 });
      return createImageBitmap(Array.isArray(conv) ? conv[0] : conv);
    }
  }
  function videoFrame(file) {                      // a still from half a second in, for the thumbnail and the paused card
    return new Promise((resolve) => {
      const v = document.createElement("video"), url = URL.createObjectURL(file);
      let done = false;
      const finish = (img) => { if (done) return; done = true; v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); resolve(img); };
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); };
      v.onseeked = () => {
        if (!v.videoWidth) return finish(null);
        const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0); finish(c);
      };
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 10000);
    });
  }
  function fit(w, h, max) { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; }
  const toBlob = (c) => new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));

  // ---------- reading a selection ----------
  async function read(fileList, onProgress) {
    const progress = onProgress || (() => {});
    const files = [...fileList].filter((f) => !f.name.startsWith(".") && kindOf(f));
    const skipped = [...fileList].filter((f) => !files.includes(f)).map((f) => f.name);

    // one item per moment: photos first; a video sharing a photo's name is that photo's motion
    const photos = new Map();
    for (const f of files) if (kindOf(f) === "photo") {
      const k = stem(f.name), had = photos.get(k);
      if (!had || f.size > had.size) photos.set(k, f);                     // copies: keep the larger
    }
    const items = [...photos.values()].map((f) => ({ file: f, kind: "photo" }));
    const clips = new Map();
    for (const f of files) if (kindOf(f) === "video") {
      const k = stem(f.name);
      if (photos.has(k)) { if (!clips.has(k)) clips.set(k, f); }
      else items.push({ file: f, kind: "video", clip: f });
    }
    for (const it of items) if (it.kind === "photo") it.clip = clips.get(stem(it.file.name)) || null;
    if (!items.length) throw new Error("none");

    let n = 0;
    await pool(items, async (it) => { Object.assign(it, await captureDate(it)); progress("dates", ++n, items.length); });
    items.sort((a, b) => a.date - b.date || (a.file.name < b.file.name ? -1 : 1));

    const atlases = [];
    const atlasAt = (ai) => atlases[ai] || (atlases[ai] = Object.assign(document.createElement("canvas"), { width: ATLAS, height: ATLAS }));
    n = 0;
    await pool(items.map((it, i) => [it, i]), async ([it, i]) => {
      try {
        const src = it.kind === "photo" ? await bitmapOf(it.file) : await videoFrame(it.file);
        if (!src) throw new Error("no image");
        const [mw, mh] = fit(src.width, src.height, MED);
        const med = Object.assign(document.createElement("canvas"), { width: mw, height: mh });
        const g = med.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, mw, mh);
        if (src.close) src.close();
        const [tw, th] = fit(mw, mh, THUMB);
        const ai = Math.floor(i / PER_ATLAS), ak = i % PER_ATLAS;
        const cx = (ak % PER_ROW) * CELL + PAD, cy = Math.floor(ak / PER_ROW) * CELL + PAD;
        const a = atlasAt(ai).getContext("2d"); a.imageSmoothingQuality = "high";
        a.drawImage(med, cx, cy, tw, th);
        a.drawImage(a.canvas, cx, cy, tw, 1, cx, cy - PAD, tw, PAD);           // repeat the edge rows so mipmaps do not bleed
        a.drawImage(a.canvas, cx, cy + th - 1, tw, 1, cx, cy + th, tw, PAD);
        it.medium = await toBlob(med);
        it.rec = { d: stamp(it.date), w: mw, h: mh, a: [ai, cx, cy, tw, th], m: [i >> 2, (i & 1) * MED, ((i >> 1) & 1) * MED, mw, mh] };
        if (it.clip) it.rec.v = "clip:" + i;
        if (it.estimated) it.rec.e = 1;                                      // date only guessed: left out of the day counts
      } catch (e) { it.failed = true; }
      progress("photos", ++n, items.length);
    });

    const ok = items.filter((it) => !it.failed);
    if (!ok.length) throw new Error("unreadable");
    skipped.push(...items.filter((it) => it.failed).map((it) => it.file.name));
    const bySheet = new Map(), clipFile = new Map(), clipURL = new Map();
    for (const it of ok) {
      const si = it.rec.m[0]; if (!bySheet.has(si)) bySheet.set(si, []); bySheet.get(si).push(it);
      if (it.rec.v) clipFile.set(it.rec.v, it.clip);
    }
    const manifest = {
      years: [...new Set(ok.map((it) => it.date.getFullYear()))].sort((x, y) => x - y),
      atlas: { size: ATLAS, files: atlases.map((_, i) => i) },
      sheet: { size: SHEET, files: [...Array(Math.ceil(items.length / 4)).keys()] },
      items: ok.map((it) => it.rec)
    };
    return {
      manifest, skipped, estimated: ok.filter((it) => it.estimated).length, own: true,
      atlas: (ai) => Promise.resolve(atlases[ai]),
      sheet: async (si) => {                       // four neighbours' 800 px copies on one 1600 px canvas, made when needed
        const c = Object.assign(document.createElement("canvas"), { width: SHEET, height: SHEET }), g = c.getContext("2d");
        await Promise.all((bySheet.get(si) || []).map(async (it) => {
          const b = await createImageBitmap(it.medium); g.drawImage(b, it.rec.m[1], it.rec.m[2]); b.close();
        }));
        return c;
      },
      clip: (key) => {
        if (!clipURL.has(key) && clipFile.has(key)) clipURL.set(key, URL.createObjectURL(clipFile.get(key)));
        return Promise.resolve(clipURL.get(key) || null);
      }
    };
  }

  async function pool(list, fn) {                  // a few at a time, so a big selection does not exhaust memory
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
      while (next < list.length) await fn(list[next++]);
    }));
  }

  // Files dropped on the page, including whole folders (and the folders inside them).
  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return [...(dt.files || [])];
    const out = [];
    const walk = async (e) => {
      if (e.isFile) out.push(await new Promise((res, rej) => e.file(res, rej)).catch(() => null));
      else if (e.isDirectory) {
        const r = e.createReader();
        for (;;) {
          const batch = await new Promise((res) => r.readEntries(res, () => res([])));
          if (!batch.length) break;
          for (const c of batch) await walk(c);
        }
      }
    };
    for (const e of entries) await walk(e);
    return out.filter(Boolean);
  }

  window.YL_INGEST = { read, filesFromDrop };
})();
