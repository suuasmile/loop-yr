# loop-yr

Spatial-sequence synesthesia in digital space: your photos on a ring of months, one ring per year. Scrolling turns the ring, and one turn is one year. The years pile up, and you can pull them apart into a cylinder.

Designed and directed by Sua. It comes from Sua's time-space synesthesia, where the year is a loop that turns to the month she is thinking of.

v2 gives each day its own weight. We take dozens of photos at a concert and a handful on an ordinary Tuesday; that number is a trace of attention. Every photo is a fine line around the ring, so the days you photographed more read denser, and the year takes the shape of how it was lived.

## The look (v2.2)

- **A tilted bowl:** the ring rises outward like a shallow bowl (`LIB.bowl`, 16°), and the overview looks down across it, steeply enough that the far side of the year is not squashed (`LIB.view`).
- **The ring leans with the calendar:** winter sits higher than summer (`LIB.lean`, 17.5°, half of the 35° it once could reach), and the lean turns with the ring.
- **Heat has two signals:** each photo's line takes its day's heat colour and stretches outward from the inner edge as long as the day is heavy (`LIB.heatLen`). A thin heat scale under the years shows only while heat is on.
- **Most active, on hover:** in the heat view, hovering the ring shows that day's date and photo count, and lights up the year's most active 30 days (the rest of the ring dims); inside that stretch the tip names it, for example "Most active: early fall". Nothing of this shows outside the heat view.
- **Layout:** the view buttons (Overview, Expanded view, Reset view) sit at the top between the lockup and the toggles; the info button sits with the toggles; the years run in a row under the date.
- **Stacks on by default;** the plain ring of lines is the quieter option.
- **Calendar labels stay put:** season and month labels are pinned to their places on the ring and keep one size, changing only with depth. They disappear when their part of the ring is off-screen, and while a photo is open.
- **Past years** fade further (`PAST`).

The previous version (v2: a face-on ring with heat as a glowing band) is kept outside the project as a backup.

## Using it

Open the site, scroll past the opening, then choose photos, choose a folder, or drag them onto the page. On a phone, "Choose photos" opens the photo library.

Everything happens in your browser. Photos are not uploaded or stored anywhere, and reloading the page starts fresh.

- Scroll (or swipe with one finger) to turn the ring. It loops within its year: past Dec 31 it comes round to Jan 1 again. The year list (or a photo in another year) moves to another year.
- Drag to move the view around, as on a design board; pinch (or ctrl/⌘ + scroll, or two fingers on a phone) to zoom toward the point under your fingers.
- **The ring:** every photo is a thin line, a slice through its middle stretched across the ring. A day's photos share its arc, so a busy day reads as a dense run of fine streaks. The selected photo lifts out of the ring at full size.
- **Stacks** (top right, or key `S`; off by default): each day's photos grow out of the ring as a compiled library column, one tile per row, first photo innermost. Quiet stretches stay a thin band of slivers, while busy days push fragmented blocks outward. Turning Stacks off folds them back into their lines.
- **Light switch** (top right, or key `L`): turns the ring into heat colours, the thermal ramp at each day's weight, so it burns hotter where days were heavy. Heat is colours only: no photo lifts out, the stacks fold away, and Stacks is unavailable until you switch back. A click on the ring still picks that day (the date pills and count follow) without leaving the overview.
- Hover brings a photo forward. Click a photo to dive in: it grows to half the screen height and everything behind it blurs. Click anywhere else, or press `Esc`, to let go of everything and return to the overview.
- When a day has several photos, pick a time in the footer to step through each one.
- The theme button (top right) flips between the cream and the black stage; by default it follows the system.
- Keys: arrows step photo to photo, `O` overview, `E` expanded view, `R` reset, `L` light switch, `S` stacks, `Esc` lets go.

## How weight is drawn

Each day gets one weight between 0 and 1 from its photo count, measured against the visitor's own busy days:

```
w = min(1, ln(1 + n) / ln(1 + n95))
```

`n` is the day's count and `n95` the count that 95% of photographed days stay at or under (the busiest day, if the album has fewer than 20 photographed days).

- **Stacks:** each row is 34 px tall (a little taller further out) with 4 px between rows. A first-row tile covers 84% of its day's arc, and tiles widen by 20% of the arc per row, up to three days' worth. Rows of a very full day pack a little closer (rank ^ 0.86). The inner ring is 150 px wide. Its lines stay at least 92% bright; with the switch on, it takes the thermal ramp at each day's weight and turns white-hot on heavy days. Brightness runs from 0.55 to 1, and past years stay greyed, but held days stay lit (× 0.6 + 0.4 w). The photo lifted out of the ring is 170 px × (0.8 + 0.6 w), grown at the front.
- This replaces v1's tube collage. The merged-bubble heat view, and the 3D burst tried after it, are set aside for now; the inner ring carries density instead.
- Seasons are labelled around the ring, and the season in view is shown larger. Fine month ticks sit along the inner edge, and month names appear once you zoom in.

Every visual value is in the tunables block at the top of `js/main.js`.

### Decisions made while building (the PRD's open questions, with the defaults used)

- **Day boundary:** 4 AM. A day runs from 4:00 AM to 3:59 AM, so a late night stays one night. The time pill and the "n photos" readout use the same days, so the count matches the glow (`DAY_START_HOUR`).
- **Burst frames and screenshots:** every frame and every screenshot counts.
- **Scale:** the whole album, so years can be compared in the cylinder.
- **Estimated dates:** photos dated only by their file's modified time are left out of the counts and drawn at weight 0.3 (`WEIGHT_ESTIMATED`).
- **Heat colour starts at one photo:** with the formula above, a one-photo day already scores 0.3, so the quiet end of the ramp (cream, orange) would never appear. The inner ring's heat colour therefore rescales weight so that a single photo reads as 0. Tile brightness and the lifted photo's size keep the formula as written (`HEAT_FROM_ONE`).
- **Seasons** follow the northern-hemisphere calendar: Winter = Dec–Feb, Spring = Mar–May, Summer = Jun–Aug, Fall = Sep–Nov. They sit in that fixed order around the ring, with the Figma label typos fixed and the stray diamond left out.
- **Clicked state:** clicking a photo dives in. The camera moves to it, it grows to half the screen height, the ring behind it blurs, and the season label moves beside it. Stepping through the day's photos from the time pill keeps you in the dive. Turning the ring leaves the dive. A click on empty space, or `Esc`, lets go of everything: nothing stays selected, and the view returns to the overview until you turn the ring or pick a photo again.
- **Opening:** "loop-yr" rises in, centred, then the subtitle. The line that used to stretch across the opening, and the progress line on the photo picker, are gone; progress shows as text.
- **Landing:** after the ring enters, it settles on the heaviest day of the most recent year.
- **"Most active":** the 30 days of the shown year that hold the most photos, named by season, for example "early fall"; shown on hover in the heat view.
- **Name on screen:** "loop-yr".

Still open: whether to restore the example album (`js/data.js` and `media/`; the button stays hidden without them) and the custom domain (`CNAME`).

## How it is built

Plain HTML, CSS and JavaScript with no build step. The ring is drawn with three.js (WebGL).

- `js/ingest.js` reads each photo's capture date (EXIF), pairs Live Photos with their motion, and packs thumbnails into texture atlases in the browser. Photos whose date was only estimated are marked so they are not counted.
- `js/main.js` contains the opening, the ring, and all motion and input. The volume is drawn in two passes. First, every photo and spike is drawn as a soft sprite, added into a half-resolution field. Then a full-screen pass turns that field into the merged body (the threshold sets the surface, and the strength inside picks the colour). The ring's lines and the Stacks tiles are two instanced draws per texture atlas, sharing the same photo data; with Stacks off, each tile sits folded into its line and is not drawn. Without the tiles, a click is matched to the ring by where the pointer meets the ring's plane. The inner ring's heat colours are drawn by the same shader as the month ticks.

## Credits

- [three.js](https://threejs.org) r128 (MIT)
- [exifr](https://github.com/MikeKovarik/exifr) 7.1.3 (MIT) reads capture dates
- [heic2any](https://github.com/alexcorvi/heic2any) 0.0.4 (MIT) converts HEIC photos in browsers that cannot open them
- [Urbanist](https://github.com/coreyhu/Urbanist) typeface (SIL Open Font License 1.1, see `fonts/OFL.txt`)
