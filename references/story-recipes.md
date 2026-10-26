# Story recipes

One patient question, one cause chain, one thing to do. 20–35 seconds, 5–7 beats, a new picture every 2–4 s.

## The shape that works

| Beat | Share | What the viewer sees |
| --- | --- | --- |
| Hook (frame 0) | 0–4 s | the familiar situation already on screen (phone posture, clenched jaw, lying after a meal) with the question as a caption; the culprit starts to glow |
| Mechanism | 4–10 s | the load or the cause made physical: an angle and a number, a muscle bulging, food going down |
| Dive (optional) | 3–5 s | a micro scene: fibres squeezing a capillary, enamel wearing, a sphincter letting acid through |
| Where it hurts | 3–5 s | back out on the body from a new angle: knots, referral path drawn on the skin, red glow zones, labels |
| Second cause (optional) | 3–5 s | posture or habit from another angle (front 3/4, back) |
| What to do | 5–7 s | the body doing the fix (chin tuck, teeth apart, sitting up / head raised), colours cooling to normal; disclaimer line last |

## By specialty

**정형외과 · 재활 · 한의원** — neck/shoulder: side view for posture and the protractor + load overlay, dive into the muscle (fiber micro), rear 3/4 for the trapezius and referred pain (temple, behind the ear, back of the neck), front 3/4 for the chest (pectoralis minor), back for weak lower trapezius, side for the fix. Discs: rear 3/4 close on the neck with trapezius/SCM faded, bulge + hot root, then front view with pain zones down the arm.

**치과** — head close-ups (dist ~100, target (0, 64, 3)). Clench pulses with `masseter.bulge`, side view for masseter + temporalis labels, open/close the jaw with TMJ glow, referral to the temple, tooth micro for wear and sensitivity, front view with the resting gap (`jawOpen` 0.07) for the fix; night guard → "치과에서 상담".

**내과 · 소화기** — torso organs with bones at ~0.3 opacity and front organs faded so the hero organ reads; bolus down the oesophagus; `bodyPitch` −90 to lie down, camera from above the hips (az −40, el 45) so the body runs up the tall frame; valve micro for the sphincter; acid `flows` + heartburn glow; sit up, then incline (−68) for "raise the head of the bed".

## Captions

- White boxes, left-aligned at x 96, first line at y 250, 78 px ExtraBold; at most ~10 Hangul characters a line, two lines at a time.
- One accent word in red: the culprit or the number.
- Vary the entrance: words blurring in, words inking from grey, a whole line blurring in. Each line enters on the narrated word it shows; exit 0.2 s before the next caption.
- Never repeat the narration verbatim: the caption is the headline, the voice is the explanation.
- Last caption is the action; a small `.note` line at y 1210 carries the disclaimer.

## Narration

- One line per beat in `narration.json` with its planned `start`. Korean speech runs ~5 syllables per second at speed 1.05: a 4 s beat holds ~20 syllables.
- Write numbers in Hangul (오 킬로, 육십 도, 이십칠 킬로, 두세 시간) so TTS reads them as intended; captions keep digits (27kg, 2~3시간).
- After generating, run `scripts/words.py` and move story and caption keys onto the printed word times. If a clip runs past the next line's `start`, shorten the text before shifting the film.

## Labels

- Name the part the moment the voice names it; keep ≤ 9 characters ("승모근", "통증 유발점", "가슴 근육 짧아짐").
- One or two labels on screen; put boxes away from the subject's silhouette, not over the face.

## Sound

- Voice at 1.0; effects at 0.3–0.6 under it: whoosh on camera dives and whip orbits, a soft impact on a knot throb, a pop on a number landing. Place each so its peak lands one frame after the picture (`npx hyperframes audio <file> --json` reports the peak).
- No music bed is bundled; on TikTok/Reels add a trending sound in the app at low volume.

## Platform

1080×1920, 30 fps. Keep words and the subject inside y 168–1330 and x < 940 (action rail). Frame 0 is the thumbnail: caption plus the body with the culprit visible.
