# Dying · 湖畔小屋

A real-time Three.js scene: a Nordic alpine lake at blue hour, a dark wine-red
cabin on the shore, and a dim living room with one warm floor lamp. Everything —
terrain, mountains, water, wood, plaster, fabric — is generated procedurally at
load time from a seeded noise library; there are no image or model assets.

## Running

```bash
npm install
npm run build      # esbuild -> dist/app.js
# then open index.html, or serve the folder:
python -m http.server 8080
```

`npm run watch` rebuilds on change. `python tools/shot.py --all --hide-ui` writes
the thirteen reference renders to `shots/`.

## Controls

| Key | Action |
| --- | --- |
| Click | capture the mouse |
| W A S D | walk |
| Mouse | look |
| Shift | run |
| Space | jump |
| M | toggle the ambient score |
| H | hide the interface |
| R | return to the opening seat |
| 1 – 8 (on-screen buttons) | jump to a framed view |

## Structure

```
src/core/      config (palette, world metrics, height fields), noise, textures, scene, util
src/world/     sky, mountains, terrain, water
src/build/     cabin, interior, furniture
src/systems/   lighting, postprocessing, collision, controller, audio
src/main.js    entry point
```

The outdoor world is one continuous space: the mountain seen through the living
room's north windows is the same mesh that stands outside, so the parallax moves
correctly as you walk. Water uses a real planar reflection render target with an
oblique near plane rather than an environment map.

## Audio

The scene ships an original WebAudio piece (wind, a low pad, sparse felt-piano
notes) that starts muted. Drop `assets/the-rescue.mp3` next to `index.html` and the
player will use that file instead — see `assets/README.md`.
