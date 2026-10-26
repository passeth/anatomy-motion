---
name: anatomy-motion
description: Make 3D glass-body anatomy explainer videos (9:16 shorts for TikTok, Reels, Shorts) with HyperFrames and Three.js — skeleton, muscles, organs, teeth, spine discs and nerves inside a transparent glowing body on a green ground, with pain points, referred-pain paths, multi-angle camera moves, micro close-ups and Korean captions, optional ElevenLabs narration. Use it whenever someone wants an anatomy, medical, health or patient-education motion graphic or short-form video, explains why something hurts (neck, shoulder, trapezius, turtle neck, disc, back, jaw/TMJ, teeth, reflux, stomach, digestion), or mentions 해부학 영상, 해부학 모션그래픽, 정형외과·치과·내과·한의원·병원 숏폼, 통증 원인 설명 영상, 거북목, 승모근, 목디스크, 턱관절, 이갈이, 역류성 식도염, 몸속 여정 영상 — even if they never say "3D" or "skill". No paid AI-video credits are used.
---

# anatomy-motion

A data-driven 3D anatomy engine for HyperFrames. Each film is a small project: a **stage** scene (the 3D body, driven by a `story` object), optional **micro** scenes (2D close-ups: muscle fibres, tooth cross-section, reflux valve), a **captions** scene, narration and sound. Everything is a pure function of time, so HyperFrames renders any frame on its own.

Read the HyperFrames skill (`/hyperframes`) for the render contract, check/snapshot/render commands and the review loop. This skill adds the anatomy engine and the medical-video craft on top of it.

## What you can show

| Specialty | Built in |
| --- | --- |
| 정형외과 / 재활 / 한의원 | posable neck (flexion, chin tuck, turning), shoulders (protraction, shrug), arms (holding a phone, relaxed, massaging the neck, stretching over the head, hand on the hip or chin) with fingers; trapezius, levator scapulae (with a "this gets longer" stretch arrow), pectoralis minor, sternocleidomastoid; cervical discs, spinal cord, nerve roots, disc herniation pressing a root; trigger-point knots; referred-pain paths; neck-load overlay (Hansraj 2014) |
| 치과 | skull with a swinging mandible (jaw open/close), 32 teeth with crowns and roots, gums; masseter (bulges when clenching) and temporalis; TMJ landmark; tooth cross-section micro scene (wear, cracks, exposed dentin, nerve sensitivity) |
| 내과 / 소화기 | lungs, heart, aorta, trachea and bronchi, oesophagus, stomach, liver, gallbladder, spleen, kidneys, duodenum, small intestine, colon; a food bolus travelling the gut; acid flowing back up the oesophagus; whole body lying down or inclined; organ heat (inflammation); sphincter (LES) micro scene |
| any | glass skin with fresnel rim and pain glows on the skin, labels with leader lines, camera keys by azimuth/elevation or "dive along the surface normal", bone/organ/muscle opacity tracks |

## Workflow

1. **Pick the one idea and the specialty.** One question a patient would ask ("왜 어깨가 뭉칠까?"), answered with one cause chain and one thing to do. 20–35 s. Read `references/story-recipes.md` for beat shapes per specialty and the caption/narration rules.
2. **Check every medical claim before animating it.** `references/medical-accuracy.md`: sources, numbers only from a source (marked 추정치 when modelled), no diagnosis or cure claims, a disclaimer line at the end. A beautiful wrong diagram is worse than none.
3. **Scaffold** from the closest example (or `blank`, a 12 s neck-disc starter):
   ```bash
   python3 <skill>/scripts/new_project.py ortho-trapezius ./my-film     # or dental-bruxism, internal-reflux, blank
   ```
   It runs `npx hyperframes init`, copies the example, the engine (`assets/anatomy-motion.js`) and, if the HyperFrames media-use skill is installed, its sound effects.
4. **Write `narration.json`** (one line per beat, numbers in Hangul). If the person has an ElevenLabs key and a voice name, generate it and wire it in, then print word times:
   ```bash
   ELEVENLABS_API_KEY=... python3 <skill>/scripts/tts_elevenlabs.py ./my-film --voice "<voice name>"
   python3 <skill>/scripts/words.py ./my-film
   ```
   Never store the key in the project or memory. Without a key, keep the planned `start` times and leave the narration block empty.
5. **Edit the story** in `compositions/stage.html`: tracks, muscles, organs, knots, paths, pain zones, camera, labels — `references/engine-api.md` has every field, anchor and landmark. Land each key on the narrated word it shows (the voice is the clock). Put labels' text in the SVG markup, not in the story.
6. **Micro scenes and captions.** Copy a micro scene from `templates/micro/` (fiber, tooth, valve), set its CONFIG block, mount it over the stage for its stretch and add that stretch to `story.skip`. Captions live in `compositions/lines.html` (white TikTok boxes, left-aligned, y 230–1300).
7. **Check, look, fix, render.** `npx hyperframes check --json`, then `npx hyperframes snapshot --at <beats>` and read the frames as a stranger would: does every frame say what it is? Then `npx hyperframes render --quality delivery --output renders/<name>.mp4` and `npx hyperframes audio <mp4> --json` (aim −16 to −14 LUFS, true peak ≤ −1 dBTP).

To add a muscle, organ, landmark or micro scene, read `references/extending.md` first.

## Rules that keep these films good

- **Look**: green radial ground (#7bcb60 → #3a8e33), glass body, ivory bone (#f5efe2), muscle #d9676c heating to #e3242e, weak muscle grey #a8a09d, nerves yellow, acid #c9dc4c. Korean captions in white boxes, 78 px ExtraBold, one accent word in #e0262f.
- **Hook at frame 0**: the caption and the body are already on screen (the frame is the thumbnail).
- **Two or three camera angles** that each show something new (side for posture, rear 3/4 for the back and referred pain, front 3/4 for chest/face, a dive into the tissue). A whip orbit between angles is fine; a slow drift during holds keeps 3D alive.
- **Show the painful place**: knots on the muscle, a referral path drawn on the skin, red glow zones on the glass, the nerve heating where it is pressed.
- **Captions never repeat the narration word for word**; each caption line enters on the word that it shows.
- **Labels**: short (≤ 9 Hangul characters), one or two on screen at a time, kept inside x 60–940 and y 200–1300 (the engine clamps them).
- **End** with what to do and a one-line disclaimer (`…계속되면 진료를 받아보세요`). Clinics using this for advertising must check their local medical-advertising rules.
- **No paid generation by default**: everything is code. Sound effects come from the local HyperFrames media-use skill (Pixabay licence: ship them inside renders, never in a repo).

## Files

```
engine/anatomy-motion.js     the engine (global AnatomyMotion): body model, glass shader, muscles, organs, teeth, overlays
examples/<name>/             complete films: index.html, compositions/{stage,lines,<micro>}.html, narration.json
templates/blank/             12 s starter (cervical disc presses the C6 root, arm lights up)
templates/micro/             fiber.html, tooth.html, valve.html — 2D close-ups with a CONFIG block
scripts/new_project.py       scaffold a HyperFrames project from an example
scripts/tts_elevenlabs.py    narration.json -> mp3 + word timings + <audio> tags
scripts/words.py             print word times
references/                  engine-api.md, story-recipes.md, medical-accuracy.md, extending.md
```
