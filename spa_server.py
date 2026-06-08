from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        requested = Path(os.getcwd(), self.path.lstrip("/").split("?", 1)[0])
        if not requested.exists() and "." not in Path(self.path).name:
            self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    os.chdir(Path(__file__).parent / "frontend" / "build")
    ThreadingHTTPServer(("127.0.0.1", 3000), SpaHandler).serve_forever()
