#!/usr/bin/env python3
"""Static server with Cache-Control like a real dev server.
   Run:  python3 serve.py   (port 8642)
"""
import http.server
import socketserver

PORT = 8642

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    with Server(('0.0.0.0', PORT), NoCacheHandler) as httpd:
        print(f'♥ naxiesian cam serving on http://localhost:{PORT} (no-cache)')
        httpd.serve_forever()
