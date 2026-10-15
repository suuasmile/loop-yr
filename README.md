# loop-yr

Spatial-sequence synesthesia in digital space: your photos on a ring of months, one ring per year. Scrolling turns the ring, and one turn is one year. The years pile up, and you can pull them apart into a cylinder.

Designed and directed by Sua. It comes from Sua's time-space synesthesia, where the year is a loop that turns to the month she is thinking of.

## Using it

Open the site, scroll past the opening, then choose photos, choose a folder, or drag them onto the page. On a phone, "Choose photos" opens the photo library.

Everything happens in your browser. Photos are not uploaded or stored anywhere, and reloading the page starts fresh.

- Scroll (or swipe with one finger) to turn the ring.
- Drag (or use two fingers) to tilt and orbit; pinch to zoom.
- Hover to bring a photo forward; click to jump to it.
- When a day has several photos, pick a time in the footer to see each one.

## How it is built

Plain HTML, CSS and JavaScript with no build step. The ring is drawn with three.js (WebGL).

- `js/ingest.js` reads each photo's capture date (EXIF), pairs Live Photos with their motion, and packs thumbnails into texture atlases in the browser.
- `js/main.js` contains the opening, the ring, and all motion and input.

## Credits

- [three.js](https://threejs.org) r128 (MIT)
- [exifr](https://github.com/MikeKovarik/exifr) 7.1.3 (MIT) reads capture dates
- [heic2any](https://github.com/alexcorvi/heic2any) 0.0.4 (MIT) converts HEIC photos in browsers that cannot open them
- [Urbanist](https://github.com/coreyhu/Urbanist) typeface (SIL Open Font License 1.1, see `fonts/OFL.txt`)
