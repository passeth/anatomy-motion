#!/usr/bin/env python3
"""Generate narration clips with ElevenLabs and wire them into a HyperFrames project.

Usage:
  ELEVENLABS_API_KEY=... python3 scripts/tts_elevenlabs.py <project-dir> [--voice NAME] [--key-file PATH]
                                                         [--speed 1.05] [--model ID] [--only ID ...] [--no-attach]

Reads  <project>/narration.json   {"voice": "...", "lines": [{"id": "v1", "start": 0.1, "text": "..."}, ...]}
Writes <project>/assets/voice/<id>.mp3
       <project>/narration.timing.json   (clip durations and per-word start/end, relative and absolute)
       <project>/index.html              (<audio> tags between <!-- narration:start --> and <!-- narration:end -->)

Write numbers in Hangul ("이십칠 킬로") so they are read as intended. The key is never written to disk.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

API = "https://api.elevenlabs.io/v1"


def api(path, key, body=None):
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode("utf-8"),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"}, method="GET" if body is None else "POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def find_voice(name, key):
    voices = api("/voices", key).get("voices", [])
    exact = [v for v in voices if v.get("name", "").lower() == name.lower()]
    loose = [v for v in voices if name.lower() in v.get("name", "").lower()]
    hit = (exact or loose or [None])[0]
    if not hit:
        sys.exit(f"voice '{name}' not found. available: {', '.join(v.get('name', '') for v in voices)}")
    return hit["voice_id"], hit["name"]


def words_from_alignment(al):
    chars, st, en = al.get("characters", []), al.get("character_start_times_seconds", []), al.get("character_end_times_seconds", [])
    words, cur, t0, t1 = [], "", None, None
    for c, a, b in zip(chars, st, en):
        if c.strip() == "":
            if cur:
                words.append({"w": cur, "t0": round(t0, 3), "t1": round(t1, 3)})
            cur, t0 = "", None
            continue
        if t0 is None:
            t0 = a
        cur += c
        t1 = b
    if cur:
        words.append({"w": cur, "t0": round(t0, 3), "t1": round(t1, 3)})
    return words


def duration_of(path, fallback):
    if shutil.which("ffprobe"):
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
        try:
            return round(float(r.stdout.strip()), 3)
        except ValueError:
            pass
    return round(fallback, 3)


def attach(project, timing):
    index = os.path.join(project, "index.html")
    html = open(index, encoding="utf-8").read()
    if "<!-- narration:start" not in html or "<!-- narration:end -->" not in html:
        print("index.html has no <!-- narration:start --> ... <!-- narration:end --> block; add one inside #root to attach the audio")
        return
    tags = "\n".join(
        f'      <audio id="vo-{c["id"]}" class="clip" src="assets/voice/{c["id"]}.mp3" data-start="{c["start"]}" data-duration="{c["duration"]}" data-track-index="20" data-volume="1"></audio>'
        for c in timing["clips"])
    html = re.sub(r"(<!-- narration:start[^\n]*-->)(.*?)(\s*<!-- narration:end -->)", lambda m: m.group(1) + "\n" + tags + m.group(3), html, flags=re.S)
    open(index, "w", encoding="utf-8").write(html)
    print(f"attached {len(timing['clips'])} clips to index.html")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--voice")
    ap.add_argument("--key-file")
    ap.add_argument("--speed", type=float)
    ap.add_argument("--model")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--no-attach", action="store_true")
    a = ap.parse_args()

    project = os.path.abspath(a.project)
    spec = json.load(open(os.path.join(project, "narration.json"), encoding="utf-8"))
    key = os.environ.get("ELEVENLABS_API_KEY") or (open(os.path.expanduser(a.key_file)).read().strip() if a.key_file else "")
    if not key:
        sys.exit("set ELEVENLABS_API_KEY or pass --key-file")
    name = a.voice or spec.get("voice", "")
    if not name:
        sys.exit('no voice: pass --voice "<ElevenLabs voice name>" or set "voice" in narration.json')
    voice_id, voice_name = find_voice(name, key)
    model = a.model or spec.get("model", "eleven_multilingual_v2")
    speed = a.speed or spec.get("speed", 1.0)
    lines = spec["lines"]
    out_dir = os.path.join(project, "assets", "voice")
    os.makedirs(out_dir, exist_ok=True)

    timing_path = os.path.join(project, "narration.timing.json")
    old = json.load(open(timing_path)) if os.path.exists(timing_path) else {"clips": []}
    clips = {c["id"]: c for c in old.get("clips", [])}
    for i, ln in enumerate(lines):
        if a.only and ln["id"] not in a.only:
            continue
        body = {
            "text": ln["text"], "model_id": model,
            "previous_text": lines[i - 1]["text"] if i > 0 else None,
            "next_text": lines[i + 1]["text"] if i + 1 < len(lines) else None,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "style": 0.15, "use_speaker_boost": True, "speed": speed},
        }
        d = api(f"/text-to-speech/{urllib.parse.quote(voice_id)}/with-timestamps?output_format=mp3_44100_128", key, body)
        mp3 = os.path.join(out_dir, f"{ln['id']}.mp3")
        open(mp3, "wb").write(base64.b64decode(d["audio_base64"]))
        words = words_from_alignment(d.get("alignment") or {})
        dur = duration_of(mp3, words[-1]["t1"] if words else 0)
        start = float(ln.get("start", 0))
        clips[ln["id"]] = {"id": ln["id"], "start": start, "duration": dur, "text": ln["text"],
                           "words": [dict(w, abs0=round(start + w["t0"], 3)) for w in words]}
        print(f"{ln['id']}: {dur:.2f}s  starts {start:.2f}  ends {start + dur:.2f}  {ln['text']}")

    ordered = [clips[ln["id"]] for ln in lines if ln["id"] in clips]
    for c, n in zip(ordered, ordered[1:]):
        if c["start"] + c["duration"] > n["start"]:
            print(f"warning: {c['id']} ends at {c['start'] + c['duration']:.2f}s, after {n['id']} starts ({n['start']:.2f}s); move the later line or shorten the text")
    timing = {"voice": voice_name, "voice_id": voice_id, "model": model, "speed": speed, "clips": ordered}
    json.dump(timing, open(timing_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if not a.no_attach:
        attach(project, timing)
    print("next: python3 scripts/words.py", project, " (print word times to align the story keys)")


if __name__ == "__main__":
    main()
