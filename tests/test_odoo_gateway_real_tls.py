"""Real local TLS handshakes through production gateway_http; no socket mocks."""
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import ssl
import threading

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import pytest
import requests

from test_odoo_gateway_pinned_transport import load_module


@pytest.fixture
def tls_gateway(tmp_path, monkeypatch):
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Yaseir ephemeral test CA")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - datetime.timedelta(minutes=1))
          .not_valid_after(now + datetime.timedelta(hours=1))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(
              digital_signature=True, content_commitment=False, key_encipherment=False,
              data_encipherment=False, key_agreement=False, key_cert_sign=True,
              crl_sign=True, encipher_only=None, decipher_only=None), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    ca_file = tmp_path / "ca.pem"
    ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    servers = []
    threads = []
    for name in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "YASEIR_GATEWAY_ALLOW_INSECURE_HTTP"):
        monkeypatch.delenv(name, raising=False)

    def start(identity="127.0.0.1"):
        index = len(servers)
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cert = (x509.CertificateBuilder().subject_name(x509.Name([
                    x509.NameAttribute(NameOID.COMMON_NAME, identity)]))
                .issuer_name(ca.subject).public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - datetime.timedelta(minutes=1))
                .not_valid_after(now + datetime.timedelta(hours=1))
                .add_extension(x509.SubjectAlternativeName([
                    x509.IPAddress(ipaddress.ip_address(identity))]), critical=False)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.KeyUsage(
                    digital_signature=True, content_commitment=False, key_encipherment=True,
                    data_encipherment=False, key_agreement=False, key_cert_sign=False,
                    crl_sign=False, encipher_only=None, decipher_only=None), critical=True)
                .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(
                    ca.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value), critical=False)
                .sign(ca_key, hashes.SHA256()))
        key_file, cert_file = tmp_path / f"server-{index}.key", tmp_path / f"server-{index}.pem"
        key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                             serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        key_file.chmod(0o600)
        cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append({"path": self.path, "authorization": self.headers.get("Authorization"),
                              "host": self.headers.get("Host")})
                self.send_response(302 if self.path == "/redirect" else 200)
                if self.path == "/redirect":
                    self.send_header("Location", "/redirect-target")
                body = b'{"ok":true}'
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cert_file, key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        servers.append(server)
        threads.append(thread)
        thread.start()
        origin = "https://127.0.0.1:%d" % server.server_port
        monkeypatch.setenv("YASEIR_GATEWAY_ALLOWED_ORIGINS", origin)
        return origin, calls

    try:
        yield start, str(ca_file), tmp_path
    finally:
        for server, thread in zip(servers, threads):
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def test_real_tls_accepts_trusted_matching_identity(tls_gateway):
    start, ca, _ = tls_gateway
    origin, calls = start()
    response = load_module("gateway_http").get(origin + "/ok", verify=ca, timeout=3)
    assert response.json() == {"ok": True}
    assert calls == [{"path": "/ok", "authorization": None, "host": origin.removeprefix("https://")}]


def test_real_tls_rejects_untrusted_ca_before_http(tls_gateway):
    start, _, _ = tls_gateway
    origin, calls = start()
    with pytest.raises(requests.exceptions.SSLError):
        load_module("gateway_http").get(origin + "/ok", verify=True, timeout=3)
    assert calls == []


def test_real_tls_rejects_trusted_ca_with_wrong_identity(tls_gateway):
    start, ca, _ = tls_gateway
    origin, calls = start("127.0.0.2")
    with pytest.raises(requests.exceptions.SSLError):
        load_module("gateway_http").get(origin + "/ok", verify=ca, timeout=3)
    assert calls == []


def test_real_tls_does_not_follow_redirect(tls_gateway):
    start, ca, _ = tls_gateway
    origin, calls = start()
    response = load_module("gateway_http").get(origin + "/redirect", verify=ca, timeout=3)
    assert response.status_code == 302
    assert [call["path"] for call in calls] == ["/redirect"]


def test_real_tls_ignores_inherited_proxy_and_netrc(tls_gateway, monkeypatch):
    start, ca, temporary = tls_gateway
    origin, calls = start()
    netrc = temporary / "test.netrc"
    netrc.write_text("machine 127.0.0.1 login synthetic-user password never-send-this-fixture\n")
    netrc.chmod(0o600)
    monkeypatch.setenv("NETRC", str(netrc))
    for name in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")
    response = load_module("gateway_http").get(origin + "/ok", verify=ca, timeout=3)
    assert response.json() == {"ok": True}
    assert len(calls) == 1 and calls[0]["authorization"] is None
