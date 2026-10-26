#!/usr/bin/env python3
"""Print the film-time of every narrated word, to align story keys and caption entrances.

Usage: python3 scripts/words.py <project-dir>
Reads <project>/narration.timing.json written by tts_elevenlabs.py.
"""
import json
import os
import sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
timing = json.load(open(os.path.join(sys.argv[1], "narration.timing.json"), encoding="utf-8"))
for c in timing["clips"]:
    print(f"[{c['id']}] {c['start']:.2f}-{c['start'] + c['duration']:.2f}s  {c['text']}")
    print("   " + "  ".join(f"{w['w']}@{w['abs0']:.2f}" for w in c["words"]))
