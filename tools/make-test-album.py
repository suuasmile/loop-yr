#!/usr/bin/env python3
"""Writes a test-album list for local testing: { files: [{ url, name }] }.

The site's ?album=<list> loader (localhost only) fetches each file and passes it to the same reader as the photo
picker. Each file is renamed to carry its capture time (20110829_143000_y0123.jpg), because the 800 px copies made by
the yearloop-build pipeline no longer hold EXIF; a photo and its clip share a name, so they pair as a Live Photo.

Usage, from the folder that holds both loop-yr-public and yearloop-build:
  python3 loop-yr-public/tools/make-test-album.py yearloop-build > yearloop-build/test-album.json
  python3 -m http.server 8123
  open http://localhost:8123/loop-yr-public/?album=/yearloop-build/test-album.json
"""
import json, os, sys

build = sys.argv[1] if len(sys.argv) > 1 else "yearloop-build"
root = "/" + build.strip("/")
stamp = lambda d: d[0:4] + d[5:7] + d[8:10] + "_" + d[11:13] + d[14:16] + (d[17:19] if len(d) >= 19 else "00")

entries = []                                     # (folder, id, date)
for it in json.load(open(os.path.join(build, "raw", "manifest-raw.json"))):
    entries.append(("raw", it["id"], it["d"]))
for it in json.load(open(os.path.join(build, "inventory-2025.json")))["items"]:
    entries.append(("raw-2025", it["id"], it["date"]))

files = []
for folder, id_, d in entries:
    name = f"{stamp(d)}_{id_}"
    if os.path.exists(os.path.join(build, folder, "m", id_ + ".jpg")):
        files.append({"url": f"{root}/{folder}/m/{id_}.jpg", "name": name + ".jpg"})
    if os.path.exists(os.path.join(build, folder, "v", id_ + ".mp4")):
        files.append({"url": f"{root}/{folder}/v/{id_}.mp4", "name": name + ".mp4"})

json.dump({"files": files}, sys.stdout)
print(f"{len(entries)} items, {len(files)} files", file=sys.stderr)
