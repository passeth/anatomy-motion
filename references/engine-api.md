# Engine API — the `story` object

`AnatomyMotion.mount({ id: "stage", story })` builds the 3D stage in the scene whose root holds `#am-canvas` (WebGL) and `#am-svg` (labels and overlays), and registers `window.__timelines[id]`. Load order in `index.html`: GSAP, three@0.158.0 (UMD), `assets/anatomy-motion.js`.

## Contents

1. Conventions · 2. Tracks · 3. `show` · 4. Pose tracks · 5. Muscles · 6. Knots, paths, pain zones · 7. Organs, bolus, flows · 8. Spine detail · 9. Camera · 10. Labels and overlays · 11. Anchors and landmarks · 12. Other fields

## 1. Conventions

- Units are centimetres. **Body space**: y up, the person faces +z, **+x is the person's left**. Side `"L"` = person's left, `"R"` = person's right.
- Rough landmarks (upright): waist y≈0, C7 (0, 47.2, -3.6), acromion (±16.6, 48.2, -1.2), occipital condyle ≈ (0, 59.1, -0.9), head top ≈ y 77.6, chest skin front z≈11, back skin z≈-10.8.
- **Head space**: origin at the occipital condyles, y up, z forward (face). Eyes (0, 6.4, 8), chin (0, -4.5, 8.6), ear (±7.4, 4.9, 0.2). **Mandible space** = head space with the mouth closed; it swings about (0, 2.4, 0.7).
- The stage's time is the scene's own time (normally film time when the stage starts at 0).

## 2. Tracks

Every animated value is a **track**: a number (constant) or keys `[[time, value, easeIntoThisKey?], ...]`. Before the first key the first value holds; after the last, the last. Ease names are GSAP's (`"power2.inOut"` default, `"none"` for a jump, `"expo.out"`, `"power3.in"`, …). Use a key pair like `[t, 1], [t + 0.05, 0, "none"]` for a cut.

## 3. `show`

```js
show: {
  skeleton: true,          // skull, mandible, spine, ribs, sternum, shoulder girdle, arms
  teeth: true,             // real crowns and roots, gums (false = simple blocks)
  spineDetail: false,      // discs, spinal cord, cervical nerve roots, herniation bulges
  pelvis: false,           // simplified iliac crests
  glass: true,             // the ray-marched glass skin
  muscles: ["trapezius", "levatorScapulae", "pectoralisMinor", "sternocleidomastoid", "masseter", "temporalis"],
  organs: ["lungs", "heart", "aorta", "airway", "esophagus", "stomach", "liver", "gallbladder", "spleen", "kidneys", "duodenum", "smallIntestine", "colon"],
}
arms: "relaxed" | "phone"   // hanging arms, or both hands holding a phone (tracks.phoneUp raises it to eye level)
arms: { L: [[0, "relaxed"], [1.5, "massage"], [7, "head"]], R: "hip" }   // per-side named poses, blended between keys
```

Named arm poses: `relaxed` (hanging, palm in), `side` (hanging, follows a shrug), `massage` (hand rubbing the opposite side of the neck), `head` (hand over the head, as in a neck stretch), `hip` (hand behind at the hip), `chin` (fingers on the chin, a chin-tuck cue). A string other than `"phone"` applies to both sides. Keys use the same `[time, value, ease?]` form as tracks (default ease `power2.inOut`). Hands have metacarpals, two phalanges per finger and a thumb; they curl toward the palm.

Organ aliases: `lungs` = lungL + lungR, `kidneys` = kidneyL + kidneyR, `airway` = trachea + bronchusL + bronchusR, `bowel` = smallIntestine + colon.

## 4. Pose tracks — `story.tracks`

| Track | Meaning |
| --- | --- |
| `tilt` | neck flexion in degrees (0 upright, 60 deep "text neck"); shared down the neck, the head rotates by the full value |
| `retract` | chin tuck 0–1 (head slides back ~2.6 cm) |
| `shoulderFwd` | shoulder protraction 0–1 (rounded shoulders); negative pulls them back |
| `phoneUp` | `arms: "phone"` only: 0 phone at chest height, 1 at eye level |
| `turn` | head rotation to the side in degrees (+ toward the person's left); shared down the neck, mostly at C1–C2 |
| `shrug` / `shrugL` / `shrugR` | shoulder elevation 0–1 (both / one side; ~2.6 cm each) |
| `jawOpen` | 0 closed … 1 (= 28°); 0.07 ≈ resting gap |
| `bodyPitch` / `bodyRoll` | whole-body rotation in degrees about the waist: pitch −90 = lying on the back (head toward −z), −68 ≈ head of the bed raised |
| `boneOpacity` | 0–1, fade the skeleton to see organs |
| `glassOpacity` | 0–1, fade the glass skin |

## 5. Muscles — `story.muscles.<name>`

```js
muscles: {
  trapezius: { heat: track, weak: track, heatV: [0, 0.42], weakV: [0.42, 1], opacity: track },
  masseter:  { heat: track, bulge: track },   // bulge thickens the belly (clenching)
}
```

- `heat` 0–1 reddens the muscle; `weak` 0–1 greys it. On sheet muscles they apply inside a band of the fibre-across coordinate `v` (`heatV`, `weakV`); trapezius defaults: upper part `[0, 0.42]` heats, middle/lower `[0.42, 1]` weakens.
- Sheet muscles have coordinates `u` (along the fibres, 0 at the origin) and `v` (across). Trapezius: v 0 = occiput … 0.375 = C7 → acromion … 1 = T12; u 0 = spine, 1 = shoulder/scapula. Masseter: u 0 = zygomatic arch, 1 = jaw angle; v 0 = front, 1 = back. Temporalis: u 0 = temporal line, 1 = coronoid; v 0 = front.
- Tube muscles (`levatorScapulae`, `sternocleidomastoid`) take `heat`, `weak`, `bulge`, `opacity`; `u` runs along the belly (levator: 0 = C1 transverse process, 1 = superior angle of the scapula; `v` is ignored). The levator has a fusiform belly plus two upper slips from C2–C4.

## 6. Knots, paths, pain zones

```js
knots: [{ id: "tp", on: "trapezius", side: "both", u: 0.5, v: 0.2, show: track, throb: track, scale: 1 }],
// side "both" makes ids tpL and tpR; a knot also blooms heat into its muscle around (u, v); on a tube muscle it sits on the belly surface at u
paths: [{ id: "referral", points: ["knot:tpR", "neck:2:-4.5,0,-2.5", "head:-5.8,0.4,-2.4", "head:-6.4,10.4,3.2"],
          draw: track, opacity: track, color: "#ffd84a", radius: 0.42, onSkin: true }],
// every point after the first is projected onto the skin (onSkin false keeps raw positions); draw 0–1 grows it from the first point
painZones: [{ anchor: "templeR", radius: 4.2, intensity: track }],   // up to 8 red glows on the glass skin
```

## 7. Organs, bolus, flows

```js
organs: { stomach: { heat: track, opacity: track }, liver: { opacity: 0.3 } },
bolus: [{ along: "upperGI", u: track, show: track, scale: 1.3, color: "#c98a52" }],        // a food lump moving along a path
flows: [{ along: "esophagus", from: 1.0, to: 0.28, radius: 1.0, color: "#c9dc4c", progress: track, opacity: track }],
```

- Organs are opaque by default; set `opacity` (0.2–0.85) on the ones in front so the hero shows through. The hero organ keeps the strongest opacity.
- Paths for `along`: `upperGI` (pharynx → oesophagus → stomach → duodenum; cardia ≈ u 0.48, stomach body ≈ 0.6), `esophagus` (u 0 top, 1 cardia), `duodenum`, `smallIntestine`, `colon`, `aorta`, `trachea`.
- `flows` draw from `from` toward `to` as `progress` goes 0 → 1 (acid creeping up: from 1 to 0.3).

## 8. Spine detail (`show.spineDetail: true`)

```js
herniation: [{ level: "C5-C6", side: "R", amount: track }]   // levels: C6-C7, C5-C6, C4-C5, C3-C4, C2-C3 (or index 0–4)
```

The bulge grows on the posterolateral disc edge and the nerve root at that level heats from yellow to red. Anchor `disc:C5-C6:R` points at it. Pair with pain zones down the arm (`acromionR`, `elbowR`, `handR`) for radiating symptoms; fade the trapezius and SCM (`opacity`) to see the column.

## 9. Camera — `story.camera`

```js
camera: [
  { t: 0,    az: -90, el: 3,  dist: 200, target: "body:0,56,5", fov: 32 },
  { t: 10.2, az: "normal", el: "normal", dist: 12, target: "muscle:trapezius:R:0.55,0.3", fov: 26, ease: "power3.in" },
]
```

- `az` (degrees around the body): 0 = in front, −90 = the person's right side (face looks screen-right), ±180 = behind, −35 = front 3/4 right, −145 = rear 3/4 right. `el` is elevation, `dist` the distance in cm, `fov` vertical degrees (default 32).
- `target` is an anchor (it follows the pose and `bodyPitch`) or `[x, y, z]`. `az`/`el` `"normal"` aim straight down the skin normal at the target: use it to dive into a muscle or to come back out of a micro scene.
- Interpolation runs in angle space with the ease of the arriving key, so a key 0.7 s after another is a whip orbit; keep the azimuths on one side of ±180 to avoid spinning the long way.
- Framing that keeps the subject inside y 230–1300 with captions above it: whole upper body side view dist 185–200 target y≈56–58; head close-up dist 100–110 target (0, 64, 3); torso organs dist 135–150 target (0, 40, 2); lying body from above the hips az −40 el 45 dist 130–150.

## 10. Labels and overlays

Markup (text is editable in Studio):
```html
<g id="lab-knot" class="lab" opacity="0"><path class="lead" /><circle class="dot" r="8" /><rect class="box" rx="12" /><text class="txt" font-size="40">통증 유발점</text></g>
```
Story: `labels: [{ id: "lab-knot", anchor: "knot:tpR", dx: -150, dy: 130, side: -1, show: track }]` — `dx, dy` offset the box from the anchor in screen px; `side` −1 box to the left, 1 right, 0 centred. Boxes are clamped to `story.safe` (default x 60–940, y 200–1300).

Overlays:
```js
overlays: {
  protractor: track,                                        // vertical vs head axis with a live degree label
  load: { show: track, table: [[0, 5], [15, 12], [30, 18], [45, 22], [60, 27]] },   // arrow from the head, length by kg at the current tilt
  arrows: [{ from: "head:0,-1.5,20", to: "head:0,-1.5,13.5", show: track, color: "#ffffff", width: 10 }],
  stretch: [{ from: "levatorOriginR", to: "superiorAngleR", show: track, side: 1, offset: 95 }],   // double arrow beside a muscle: "this gets longer"; side 1 = screen right of the muscle, -1 = left; offset in px
}
```

## 11. Anchors and landmarks

| Anchor | Meaning |
| --- | --- |
| `body:x,y,z` (or `[x,y,z]`) | body space |
| `head:x,y,z` / `mand:x,y,z` | head space / mandible space (moves with tilt, retract, jawOpen) |
| `neck:i:dx,dy,dz` | cervical chain joint i (0 = C7 … 7 = condyles) plus an offset |
| `muscle:<name>:<L|R>:u,v` | a point on a muscle surface |
| `knot:<id>` | a knot's position (after `both` expansion: `<id>L`, `<id>R`) |
| `organ:<name>` / `organ:<name>:u` | an organ's centre / a point along a tube organ or path |
| `disc:<level>[:L|R]` | a cervical disc centre or its posterolateral edge |
| `skin:<anchor>` | any anchor projected onto the glass skin |
| `<landmark>` | named points below |

Landmarks: `C7, occiput, eyes, chin, throat, templeL/R, mastoidL/R, earL/R, tmjL/R, cheekL/R, neckBackL/R, neckBaseL/R, scapulaMedialL/R, levatorOriginL/R, superiorAngleL/R, acromionL/R, scapulaL/R, pecL/R, elbowL/R, handL/R, sternum, heartburn, epigastrium, navel, lowerBack, les, pylorus`.

Pose landmarks for custom muscles: `sk.tp(i, s, lat, fw)` is a point beside cervical joint `i` on side `s` (+1 left), `lat` cm sideways and `fw` cm forward in the neck's own frame, so it follows `tilt` and `turn`.

## 12. Other fields

- `duration` (s, required) — the stage timeline length.
- `skip: [[a, b], ...]` — do not draw inside these windows (a micro scene covers them); saves render time.
- `safe: { x0, x1, y0, y1 }` — label clamp area.
- `pathColor` — default colour for paths.
- `AnatomyMotion.track(t, keys)` is exported for micro scenes; `AnatomyMotion.MUSCLES`, `ORGANS`, `LANDMARKS` are open for extension (see extending.md).
