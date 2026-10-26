#!/usr/bin/env python3
"""Scaffold a HyperFrames project from an anatomy-motion example or the blank template.

Usage:
  python3 scripts/new_project.py <example|blank> <dest-dir> [--sfx-dir DIR] [--no-init]

Examples: ortho-trapezius, dental-bruxism, internal-reflux  (see examples/)
What it does:
  1. `npx hyperframes init <dest> --resolution portrait --non-interactive` (scaffold, pinned CLI, agent notes)
  2. copies the example's index.html, compositions/, narration.json and SPEC.md over it
  3. copies engine/anatomy-motion.js to <dest>/assets/anatomy-motion.js
  4. sound effects: copies the files the example uses from the local HyperFrames media-use skill
     (Pixabay licence: they may ship inside a rendered video but not be redistributed on their own,
     so this repo never contains them). If they cannot be found, the <!-- sfx --> block is removed.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SFX_CANDIDATES = [
    "~/.claude/skills/media-use/audio/assets/sfx",
    "~/.agents/skills/media-use/audio/assets/sfx",
    "~/.codex/skills/media-use/audio/assets/sfx",
]


def find_sfx_dir(explicit):
    if explicit:
        return os.path.expanduser(explicit)
    for c in SFX_CANDIDATES:
        p = os.path.expanduser(c)
        if os.path.isdir(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="example name (folder in examples/) or 'blank'")
    ap.add_argument("dest")
    ap.add_argument("--sfx-dir", help="folder holding whoosh.mp3, pop.mp3 ... (default: the HyperFrames media-use skill)")
    ap.add_argument("--no-init", action="store_true", help="skip `hyperframes init` (dest already scaffolded)")
    a = ap.parse_args()

    src = os.path.join(ROOT, "templates", "blank") if a.source == "blank" else os.path.join(ROOT, "examples", a.source)
    if not os.path.isdir(src):
        names = sorted(os.listdir(os.path.join(ROOT, "examples")))
        sys.exit(f"unknown source '{a.source}'. choose one of: blank, {', '.join(names)}")
    dest = os.path.abspath(a.dest)

    if not a.no_init:
        if os.path.exists(os.path.join(dest, "index.html")):
            sys.exit(f"{dest} already has an index.html; use --no-init to overlay onto it")
        r = subprocess.run(["npx", "--yes", "hyperframes", "init", dest, "--resolution", "portrait", "--non-interactive"], capture_output=True, text=True)
        if not os.path.exists(os.path.join(dest, "index.html")):
            print(r.stdout[-2000:], r.stderr[-2000:])
            sys.exit("hyperframes init failed (Node 22+ and FFmpeg are required)")

    for name in ("index.html", "narration.json", "SPEC.md"):
        p = os.path.join(src, name)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(dest, name))
    shutil.copytree(os.path.join(src, "compositions"), os.path.join(dest, "compositions"), dirs_exist_ok=True)
    os.makedirs(os.path.join(dest, "assets"), exist_ok=True)
    shutil.copy2(os.path.join(ROOT, "engine", "anatomy-motion.js"), os.path.join(dest, "assets", "anatomy-motion.js"))

    index_path = os.path.join(dest, "index.html")
    html = open(index_path, encoding="utf-8").read()
    wanted = sorted(set(re.findall(r'src="assets/sfx/([^"]+)"', html)))
    sfx_dir = find_sfx_dir(a.sfx_dir)
    missing = [w for w in wanted if not (sfx_dir and os.path.exists(os.path.join(sfx_dir, w)))]
    if wanted and not missing:
        os.makedirs(os.path.join(dest, "assets", "sfx"), exist_ok=True)
        for w in wanted:
            shutil.copy2(os.path.join(sfx_dir, w), os.path.join(dest, "assets", "sfx", w))
        print(f"sfx: copied {len(wanted)} files from {sfx_dir}")
    elif wanted:
        html = re.sub(r"\s*<!-- sfx:start.*?<!-- sfx:end -->", "", html, flags=re.S)
        open(index_path, "w", encoding="utf-8").write(html)
        print(f"sfx: not found ({', '.join(missing)}); removed the sound-effect block. Pass --sfx-dir to add them.")

    print(f"ready: {dest}")
    print("next:  cd into it, then  npx hyperframes check  /  npx hyperframes preview --background")


if __name__ == "__main__":
    main()
