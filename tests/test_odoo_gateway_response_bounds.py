"""Exercise the production Gateway transport against bounded local HTTP fixtures."""
import ast
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

import pytest
import requests

from test_odoo_gateway_pinned_transport import MODELS, load_module


RESPONSE_LIMIT = 2 * 1024 * 1024


@pytest.fixture
def gateway_response_server(monkeypatch):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append(self.path)
            oversized = b"x" * (RESPONSE_LIMIT + 1)
            data = gzip.compress(oversized) if self.path == "/gzip" else oversized
            if self.path == "/small":
                data = b'{"ok":true,"service":"yaseir-print-gateway"}'
            elif self.path == "/exact":
                data = oversized[:-1]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Request-ID", "bounded-response-test")
            if self.path == "/gzip":
                self.send_header("Content-Encoding", "gzip")
            if self.path == "/chunked":
                self.send_header("Transfer-Encoding", "chunked")
            elif self.path != "/unframed":
                self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                for offset in range(0, len(data), 64 * 1024):
                    chunk = data[offset:offset + 64 * 1024]
                    if self.path == "/chunked":
                        self.wfile.write(("%x\r\n" % len(chunk)).encode("ascii"))
                    self.wfile.write(chunk)
                    if self.path == "/chunked":
                        self.wfile.write(b"\r\n")
                if self.path == "/chunked":
                    self.wfile.write(b"0\r\n\r\n")
            except (BrokenPipeError, ConnectionResetError):
                # A correct client closes an oversized body before consuming it.
                return

        do_POST = do_GET

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = "http://127.0.0.1:%d" % server.server_port
    monkeypatch.setenv("YASEIR_GATEWAY_ALLOW_INSECURE_HTTP", "1")
    monkeypatch.setenv("YASEIR_GATEWAY_ALLOWED_ORIGINS", origin)
    try:
        yield origin, calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize("path", ["/framed", "/chunked", "/unframed", "/gzip"])
def test_control_plane_response_is_bounded_after_decoding(gateway_response_server, path):
    transport = load_module("gateway_http")
    origin, calls = gateway_response_server
    with pytest.raises(requests.RequestException, match="response exceeds"):
        transport.get(origin + path, timeout=2)
    assert calls == [path]


def test_success_keeps_requests_response_json_and_headers(gateway_response_server):
    transport = load_module("gateway_http")
    origin, calls = gateway_response_server
    response = transport.get(origin + "/small", timeout=2)
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "bounded-response-test"
    assert response.json() == {"ok": True, "service": "yaseir-print-gateway"}
    assert response.content == b'{"ok":true,"service":"yaseir-print-gateway"}'
    assert calls == ["/small"]


def test_response_at_the_exact_limit_is_accepted(gateway_response_server):
    transport = load_module("gateway_http")
    origin, calls = gateway_response_server
    response = transport.get(origin + "/exact", timeout=2)
    assert len(response.content) == RESPONSE_LIMIT
    assert calls == ["/exact"]


def test_oversized_post_response_is_ambiguous_and_never_retried(gateway_response_server):
    transport = load_module("gateway_http")
    origin, calls = gateway_response_server
    with pytest.raises(requests.RequestException, match="response exceeds") as failure:
        transport.post(origin + "/chunked", timeout=2)
    tree = ast.parse((MODELS / "print_job.py").read_text())
    classifier = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                      and node.name == "_is_pre_dispatch_error")
    classifier.decorator_list = []
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[classifier], type_ignores=[])),
                 "print_job.py", "exec"), namespace)
    assert not namespace["_is_pre_dispatch_error"](None, failure.value)
    assert calls == ["/chunked"]


def test_explicit_streaming_retains_caller_owned_inventory_bound(gateway_response_server):
    transport = load_module("gateway_http")
    origin, calls = gateway_response_server
    with transport.get(origin + "/framed", timeout=2, stream=True) as response:
        # Inventory code already owns a 2 MiB bound and consumes this stream.
        assert response._content_consumed is False
        assert next(response.iter_content(chunk_size=16)) == b"x" * 16
    assert calls == ["/framed"]
