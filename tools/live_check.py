"""Open the deployed Pages build and verify it actually runs."""
import json, sys
from playwright.sync_api import sync_playwright

URL = "https://zer0zn.github.io/dying/"
logs, errors = [], []

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True, args=[
        "--use-angle=d3d11", "--enable-webgl", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"])
    pg = b.new_page(viewport={"width": 1600, "height": 1000})
    pg.on("console", lambda m: (logs.append((m.type, m.text)),
                                errors.append(m.text) if m.type == "error" else None))
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.goto(URL, wait_until="load", timeout=90000)
    pg.wait_for_function("window.__DL_READY === true", timeout=90000)
    pg.wait_for_timeout(3500)
    stats = pg.evaluate("JSON.stringify(window.__D.stats ? window.__D.stats() : {})")
    appjs = pg.evaluate("""() => {
        const e = performance.getEntriesByType('resource').filter(r => r.name.includes('app.js'))[0];
        return e ? {bytes: e.transferSize, dur: Math.round(e.duration)} : null; }""")
    pg.screenshot(path="shots/live.png")
    print("stats:", stats)
    print("app.js:", json.dumps(appjs))
    print("console errors:", errors if errors else "none")
    print("console lines:", len(logs))
    b.close()
