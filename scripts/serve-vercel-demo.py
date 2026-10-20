"""Loopback test server for the exact static output and headers sent to Vercel."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dist = root / "frontend/dist"
if 'data-mode="offline"' not in (dist / "index.html").read_text():
    raise SystemExit("Run npm --prefix frontend run build:vercel first")
headers = json.loads((root / "vercel.json").read_text())["headers"][0]["headers"]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        for header in headers:
            self.send_header(header["key"], header["value"])
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None


ThreadingHTTPServer(("127.0.0.1", 8013), partial(Handler, directory=str(dist))).serve_forever()
