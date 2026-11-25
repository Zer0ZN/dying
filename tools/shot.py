#!/usr/bin/env python3
"""Screenshot harness for the Dying scene.

Serves the project root, opens it in headless Edge, waits for window.__DL_READY
and writes a PNG. Every option is optional; with no arguments it grabs the
default first-person view.

  python tools/shot.py                                  # default view
  python tools/shot.py --view living --name 01-living
  python tools/shot.py --pose -3.4 3.28 0 2 4 30 --name custom
  python tools/shot.py --js "window.__D.resetView()" --name reset
  python tools/shot.py --all                            # every named view
"""

import argparse
import functools
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
SHOTS.mkdir(exist_ok=True)

ARGS = [
    "--use-angle=d3d11",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
]

VIEWS = [
    "living",
    "living-sofa",
    "bedroom",
    "bedroom-bed",
    "window",
    "doorway",
    "exterior",
    "exterior-front",
    "cabin-back",
    "shore",
    "lake",
    "aerial",
    "peak",
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def serve(directory: Path):
    handler = functools.partial(Quiet, directory=str(directory))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def shoot(page, name, wait):
    time.sleep(wait / 1000.0)
    out = SHOTS / f"{name}.png"
    page.screenshot(path=str(out))
    print(f"  saved {out.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="shot")
    ap.add_argument("--view", default=None)
    ap.add_argument("--poses", default=None,
                    help="JSON list of [name, px,py,pz, tx,ty,tz, fov]")
    ap.add_argument("--pose", nargs=6, type=float, default=None,
                    metavar=("PX", "PY", "PZ", "TX", "TY", "TZ"))
    ap.add_argument("--fov", type=float, default=None)
    ap.add_argument("--js", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--w", type=int, default=1600)
    ap.add_argument("--h", type=int, default=1000)
    ap.add_argument("--wait", type=int, default=1400)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--hide-ui", action="store_true")
    args = ap.parse_args()

    httpd, port = serve(ROOT)
    logs = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True, args=ARGS)
            page = browser.new_page(viewport={"width": args.w, "height": args.h},
                                    device_scale_factor=1)
            page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))

            url = f"http://127.0.0.1:{port}/index.html?q={args.quality}"
            print(f"open {url}")
            page.goto(url, wait_until="domcontentloaded")
            try:
                page.wait_for_function("window.__DL_READY === true", timeout=180000)
            except Exception:
                page.screenshot(path=str(SHOTS / "FAILED.png"))
                print("!! scene never became ready — see shots/FAILED.png")
                for line in logs[-40:]:
                    print("   ", line)
                browser.close()
                return 1

            if args.hide_ui:
                page.evaluate("document.body.classList.add('hide-ui')")

            if args.poses:
                for entry in json.loads(args.poses):
                    vname, px, py, pz, tx, ty, tz, fov = entry
                    page.evaluate(
                        "([a,b,c,d,e,f,g]) => window.__D.setView(a,b,c,d,e,f,g)",
                        [px, py, pz, tx, ty, tz, fov],
                    )
                    if args.js:
                        result = page.evaluate(args.js)
                        if result is not None:
                            print("js:", json.dumps(result, default=str)[:4000])
                    shoot(page, vname, args.wait)
            elif args.all:
                for v in VIEWS:
                    page.evaluate("(v)=>window.__D.view(v)", v)
                    shoot(page, v, args.wait)
            else:
                if args.view:
                    page.evaluate("(v)=>window.__D.view(v)", args.view)
                if args.pose:
                    page.evaluate(
                        "([a,b,c,d,e,f,g]) => window.__D.setView(a,b,c,d,e,f,g)",
                        list(args.pose) + [args.fov] if args.fov else list(args.pose) + [0],
                    )
                if args.js:
                    result = page.evaluate(args.js)
                    if result is not None:
                        print("js:", json.dumps(result, default=str)[:4000])
                shoot(page, args.name, args.wait)

            try:
                stats = page.evaluate("window.__D && window.__D.stats ? window.__D.stats() : null")
                print("stats:", json.dumps(stats))
            except Exception as exc:
                print("stats unavailable:", exc)

            errs = [l for l in logs if l.startswith("[pageerror]") or "[error]" in l]
            if errs:
                print(f"-- {len(errs)} error line(s) --")
                for line in errs[:25]:
                    print("   ", line)
            else:
                print("no console errors")

            browser.close()
    finally:
        httpd.shutdown()

    return 0


if __name__ == "__main__":
    sys.exit(main())
