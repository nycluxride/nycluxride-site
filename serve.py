import http.server
import socketserver
import os

PORT = 3015
ROOT = os.path.dirname(os.path.abspath(__file__))


class CleanURLHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        local = super().translate_path(path)
        # If the requested path has no extension and isn't an existing dir/file,
        # try appending .html (clean URLs: /about -> about.html).
        if not os.path.exists(local) and not os.path.splitext(local)[1]:
            html = local + ".html"
            if os.path.exists(html):
                return html
        return local

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableTCPServer(("0.0.0.0", PORT), CleanURLHandler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{PORT}")
        httpd.serve_forever()
