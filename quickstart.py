#!/usr/bin/env python3
"""Live editing stream quick start launcher."""

from __future__ import annotations

import argparse
import http.client
import os
import select
import socket
import ssl
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ENV_BASES = {
    "cn": "https://api.vidu.cn",
    "ovs": "https://api.vidu.com",
}

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def load_dotenv(path: Path) -> None:
    """Load simple KEY=VALUE entries without overriding the shell environment."""
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key.isidentifier():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


class LiveDemoHandler(SimpleHTTPRequestHandler):
    """Static page server plus HTTP/WebSocket reverse proxy."""

    env_bases = ENV_BASES
    verbose = False

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:
        if self.path.startswith("/proxy/"):
            if self._is_websocket_upgrade():
                self._proxy_websocket()
                return
            self._proxy_http()
            return
        super().do_GET()

    def do_POST(self) -> None:
        self._proxy_http()

    def do_PUT(self) -> None:
        self._proxy_http()

    def do_PATCH(self) -> None:
        self._proxy_http()

    def do_DELETE(self) -> None:
        self._proxy_http()

    def do_OPTIONS(self) -> None:
        if self.path.startswith("/proxy/"):
            self._proxy_http()
            return
        super().do_OPTIONS()

    def log_message(self, fmt: str, *args: object) -> None:
        if self.verbose or not self.path.startswith("/proxy/"):
            super().log_message(fmt, *args)

    def _proxy_http(self) -> None:
        route = self._resolve_proxy_route()
        if route is None:
            return
        target, upstream_path, query = route

        content_length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(content_length) if content_length else None
        headers = self._build_http_headers(target, query)
        upstream_uri = self._join_path_query(upstream_path, self._query_without_auth(query, headers.get("Authorization")))

        conn_cls = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(target.hostname, target.port or self._default_port(target), timeout=60)
        try:
            conn.request(self.command, upstream_uri, body=body, headers=headers)
            resp = conn.getresponse()
            resp_body = resp.read()
        except Exception as err:  # noqa: BLE001
            self.send_error(502, f"proxy error: {err}")
            return
        finally:
            conn.close()

        self.send_response(resp.status, resp.reason)
        skipped = HOP_BY_HOP_HEADERS | {"content-length"}
        for key, value in resp.getheaders():
            if key.lower() in skipped:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def _proxy_websocket(self) -> None:
        route = self._resolve_proxy_route()
        if route is None:
            return
        target, upstream_path, query = route

        auth = self._normalize_auth(self.headers.get("Authorization"), urllib.parse.parse_qs(query).get("authorization", [""])[0])
        upstream_query = self._query_without_auth(query, auth)
        upstream_uri = self._join_path_query(upstream_path, upstream_query)

        upstream: socket.socket | None = None
        tunnel_started = False
        try:
            upstream = self._dial_upstream(target)
            request = self._build_ws_handshake(target, upstream_uri, auth)
            upstream.sendall(request)
            response = self._read_ws_handshake(upstream)
            self.connection.sendall(response)
            if not response.startswith(b"HTTP/1.1 101") and not response.startswith(b"HTTP/1.0 101"):
                return
            self.close_connection = True
            tunnel_started = True
            self._tunnel_websocket(upstream)
        except Exception as err:  # noqa: BLE001
            try:
                self.send_error(502, f"websocket proxy error: {err}")
            except Exception:  # noqa: BLE001
                pass
        finally:
            if upstream is not None and not tunnel_started:
                upstream.close()

    def _resolve_proxy_route(self) -> tuple[urllib.parse.SplitResult, str, str] | None:
        parsed = urllib.parse.urlsplit(self.path)
        rest = parsed.path.removeprefix("/proxy/")
        env, sep, upstream_rest = rest.partition("/")
        if not env or not sep or not upstream_rest:
            self.send_error(400, "usage: /proxy/{env}/live/...")
            return None
        base = self.env_bases.get(env)
        if not base:
            available = ", ".join(sorted(self.env_bases))
            self.send_error(400, f"unknown env {env!r}, available: {available}")
            return None
        return urllib.parse.urlsplit(base), "/" + upstream_rest, parsed.query

    def _build_http_headers(self, target: urllib.parse.SplitResult, query: str) -> dict[str, str]:
        headers: dict[str, str] = {}
        for key, value in self.headers.items():
            lower = key.lower()
            if lower in HOP_BY_HOP_HEADERS or lower in {"host", "content-length"}:
                continue
            headers[key] = value
        headers["Host"] = target.netloc
        auth = self._normalize_auth(headers.get("Authorization"), urllib.parse.parse_qs(query).get("authorization", [""])[0])
        if auth:
            headers["Authorization"] = auth
        return headers

    def _build_ws_handshake(self, target: urllib.parse.SplitResult, upstream_uri: str, auth: str) -> bytes:
        lines = [
            f"GET {upstream_uri} HTTP/1.1",
            f"Host: {target.netloc}",
            "Upgrade: websocket",
            "Connection: Upgrade",
        ]
        for key in (
            "Sec-WebSocket-Key",
            "Sec-WebSocket-Version",
            "Sec-WebSocket-Protocol",
            "Sec-WebSocket-Extensions",
            "Origin",
            "User-Agent",
        ):
            value = self.headers.get(key)
            if value:
                lines.append(f"{key}: {value}")
        if auth:
            lines.append(f"Authorization: {auth}")
        lines.extend(["", ""])
        return "\r\n".join(lines).encode("utf-8")

    def _dial_upstream(self, target: urllib.parse.SplitResult) -> socket.socket:
        port = target.port or self._default_port(target)
        raw = socket.create_connection((target.hostname, port), timeout=30)
        if target.scheme == "https":
            context = ssl.create_default_context()
            return context.wrap_socket(raw, server_hostname=target.hostname)
        return raw

    @staticmethod
    def _read_ws_handshake(upstream: socket.socket) -> bytes:
        chunks: list[bytes] = []
        while b"\r\n\r\n" not in b"".join(chunks):
            chunk = upstream.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)

    def _tunnel_websocket(self, upstream: socket.socket) -> None:
        sockets = [self.connection, upstream]
        try:
            while True:
                readable, _, _ = select.select(sockets, [], [], 60)
                if not readable:
                    continue
                for sock in readable:
                    data = sock.recv(65536)
                    if not data:
                        return
                    peer = upstream if sock is self.connection else self.connection
                    peer.sendall(data)
        finally:
            upstream.close()

    def _is_websocket_upgrade(self) -> bool:
        return self.headers.get("Upgrade", "").lower() == "websocket"

    @staticmethod
    def _normalize_auth(header_value: str | None, query_value: str | None) -> str:
        value = (header_value or "").strip() or (query_value or "").strip()
        if not value:
            return ""
        if value.startswith("Bearer ") or value.startswith("Token "):
            return value
        if value.startswith("vda_"):
            return "Token " + value
        return value

    @staticmethod
    def _query_without_auth(query: str, auth: str | None) -> str:
        if not auth:
            return query
        pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
        pairs = [(key, value) for key, value in pairs if key.lower() != "authorization"]
        return urllib.parse.urlencode(pairs)

    @staticmethod
    def _join_path_query(path: str, query: str) -> str:
        return path if not query else f"{path}?{query}"

    @staticmethod
    def _default_port(target: urllib.parse.SplitResult) -> int:
        return 443 if target.scheme == "https" else 80


def parse_addr(value: str) -> tuple[str, int]:
    if value.startswith(":"):
        return "127.0.0.1", int(value[1:])
    host, sep, port = value.rpartition(":")
    if not sep:
        return value, 28891
    return host or "127.0.0.1", int(port)


def build_demo_url(host: str, port: int, args: argparse.Namespace) -> str:
    query = {
        "env": args.env,
    }
    if args.api_key:
        query["api_key"] = args.api_key
    encoded = urllib.parse.urlencode(query)
    return f"http://{host}:{port}/index.html?{encoded}"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the Live editing stream Python quick start.")
    parser.add_argument("--env", default="ovs", choices=sorted(ENV_BASES), help="Target environment: cn=China, ovs=global")
    parser.add_argument("--api-key", default=os.getenv("VIDU_API_KEY", ""), help="vda_... API Key, or set VIDU_API_KEY in .env")
    parser.add_argument("--addr", default="127.0.0.1:28891", help="Local listen address, for example 127.0.0.1:28891 or :28891")
    parser.add_argument("--no-open", action="store_true", help="Start the server without opening a browser")
    parser.add_argument("--verbose", action="store_true", help="Print proxy access logs")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    static_dir = Path(__file__).resolve().parent
    load_dotenv(static_dir / ".env")
    args = parse_args(argv)
    index_path = static_dir / "index.html"
    if not index_path.is_file():
        print(f"Page file not found: {index_path}", file=sys.stderr, flush=True)
        return 1

    host, port = parse_addr(args.addr)
    url = build_demo_url("127.0.0.1" if host in {"", "0.0.0.0"} else host, port, args)

    LiveDemoHandler.verbose = args.verbose
    handler_cls = lambda *handler_args, **handler_kwargs: LiveDemoHandler(  # noqa: E731
        *handler_args,
        directory=str(static_dir),
        **handler_kwargs,
    )
    try:
        httpd = ThreadingHTTPServer((host, port), handler_cls)
    except OSError as exc:
        print(
            f"Failed to listen on {host}:{port}: {exc}\n"
            "The port may be taken by another demo server. "
            f"Check: lsof -nP -iTCP:{port} -sTCP:LISTEN; or pass --addr to use another port.",
            file=sys.stderr,
        )
        return 1

    print(f"Live editing stream demo: {url}", flush=True)
    print(f"Static dir: {static_dir}", flush=True)
    print(f"Proxy envs: {', '.join(sorted(ENV_BASES))}", flush=True)
    if args.api_key:
        print("API Key: injected into the page from --api-key or VIDU_API_KEY; page logs will mask it.", flush=True)
    else:
        print("API Key: not provided. Enter vda_... manually on the page.", flush=True)

    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nInterrupt received, shutting down.", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
