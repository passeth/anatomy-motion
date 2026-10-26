# Extending the engine

`engine/anatomy-motion.js` exposes its registries, so most additions are data. Edit the engine in the skill (not a project copy) when the addition is reusable, then re-copy it into projects (`scripts/new_project.py` copies it at scaffold time).

## Add a muscle

Sheet muscles (flat bellies: trapezius, masseter) and tube muscles (fusiform: SCM, levator).

```js
AnatomyMotion.MUSCLES.rhomboid = {
  kind: "sheet", nu: 10, nv: 12, surface: "skin", depth: 0.9,   // projected under the skin; "skull" projects onto the cranium; "none" keeps raw points
  // either keys(sk, side) -> { M: [...], B: [...] } (curves at fibre origin and insertion, sampled by v)
  // or point(sk, side, u, v, P) -> THREE.Vector3 in body space
  point(sk, side, u, v) {
    const s = side.s;                                   // +1 left, -1 right
    const spine = new THREE.Vector3(0, AnatomyMotion.track(v, [[0, 44], [1, 36]]), -10.4);
    const scap = side.SA.clone().lerp(side.IA, v * 0.7); // medial border of the scapula
    return spine.lerp(scap, u);
  },
};
```

Rules: `u` runs along the fibres (the fibre texture follows it), `v` across; return **body space**. Use the pose landmarks in `sk` (`sk.ch` cervical chain, `sk.hw(x,y,z)` head space, `sk.mw` mandible space, `sk.side[i]` with `A` acromion, `SA`/`IA`/`RS` scapula, `C` coracoid, `G` humeral head, `E` elbow, `W` wrist). Sheets under the skin need `surface: "skin"` and a depth (0.5–1 cm) or deeper muscles would poke through the glass.

Tube muscle: `{ kind: "tube", color, radius: (u) => ..., pts: (sk, side) => [Vector3, ...], segs?, slips?: (sk, side) => [{ pts, radius }] }`. Use `sk.tp(i, s, lat, fw)` for points on the neck so the muscle follows a head turn.

Muscle geometry is recomputed only when the pose changes (cache key: tilt, retract, shoulderFwd, jawOpen, bulge, turn, shrug). Muscles project onto the skin without the arms, so a raised hand never captures them.

## Add an arm pose

Edit `armTarget(name, s, sk, o, P)` in the engine: return `{ W, pole, palm }` — the wrist position in body space (or head space through `sk.hw`), a pole vector relative to the shoulder that decides where the elbow points, and the direction the palm faces (fingers curl that way). `s` is +1 for the left arm.

## Add an organ

```js
AnatomyMotion.ORGANS.appendix = { kind: "tube", color: "#e2ae9c", pts: [new THREE.Vector3(-7.4, 3.6, 3.2), new THREE.Vector3(-6.8, 0.8, 3.6)], radius: () => 0.45, segs: 20 };
AnatomyMotion.ORGANS.pancreas = { kind: "sdf", color: "#e8c08a", h: 0.25, center: new THREE.Vector3(1, 19, -1), b0: [-6, 15, -4], b1: [9, 23, 2],
  f: (x, y, z) => /* signed distance in cm, negative inside */ 0 };
```

SDF organs are meshed once at load with surface nets (`h` = grid step; keep the box `b0`–`b1` tight: cost grows with its volume / h³). Build shapes from the primitives the engine uses (ellipsoids, round cones, smooth union `smin`, smooth cut `smax`); a flat cut is `smax(d, plane - y, k)`. Register before `mount()` runs (put the code at the top of the stage script).

## Add a landmark

`AnatomyMotion.LANDMARKS.lumbarL4 = (sk, stage) => new THREE.Vector3(0, 7, -9.8);` then use `"lumbarL4"` as an anchor.

## Add a micro scene

Copy `templates/micro/<scene>.html`, rename the composition id and every element id prefix (ids are global in the assembled page), and edit the CONFIG block (scene-local seconds). Mount it in `index.html` over the stage with a higher `z-index` and add its window to `story.skip`. Enter blurred (14 px → 0 in 0.5 s) and leave blurring, so it reads as a dive and a return; match the stage camera on both sides (dive along the surface `"normal"` into it, come back out of the same spot).

## Pitfalls already met

- **Surface nets winding**: triangles come out with mixed winding; the engine turns each one to face along the SDF gradient. Without it, front-face shading shows dotted terraces.
- **Bones poking through muscle**: spinous processes and cervical tips must stay ≥ 0.1 cm under the trapezius; check rear views at full tilt.
- **Glass over opaque props**: the glass writes its own depth, so a phone in front of the chest is not covered; seen from behind it would float through the body, so the engine fades it by camera azimuth.
- **Transparent organs**: below 0.6 opacity they stop writing depth; give the hero organ the highest opacity so it does not sort behind faded ones.
- **Labels**: measure once after fonts load; boxes clamp to the safe area, so a label anchored near the top edge slides under the captions — give it a downward `dy`.
- **Determinism**: no `Math.random`, timers or clocks; integrate speeds numerically from t (see the fiber scene's red cells) and seed any randomness.
- **Skip windows**: `story.skip` stops drawing while a micro scene covers the stage; the last drawn frame stays in the canvas underneath.
