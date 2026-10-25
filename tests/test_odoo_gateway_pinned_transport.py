"""Exercise the real HTTP boundary without making an external connection."""
import ast
import importlib.util
from pathlib import Path
import socket
import sys
from types import ModuleType

import pytest
import requests


MODELS = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models"


def load_module(name):
    package = "yaseir_transport_under_test"
    if package not in sys.modules:
        module = ModuleType(package)
        module.__path__ = [str(MODELS)]
        sys.modules[package] = module
    qualified = package + "." + name
    if qualified not in sys.modules:
        spec = importlib.util.spec_from_file_location(qualified, MODELS / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[qualified] = module
        spec.loader.exec_module(module)
    return sys.modules[qualified]


def production_http():
    """Resolve the actual module imported at the configuration boundary."""
    tree = ast.parse((MODELS / "gateway_config.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            if any(alias.name == "gateway_http" and alias.asname == "requests" for alias in node.names):
                return load_module("gateway_http")
    assert any(isinstance(node, ast.Import) and any(a.name == "requests" for a in node.names)
               for node in tree.body)
    return requests


@pytest.fixture
def socket_boundary(monkeypatch):
    # A socket never reaches the operating system: record the attempted target
    # and fail before TLS or an Authorization header can be transmitted.
    connects = []
    resolutions = []

    def resolve(host, port, *args, **kwargs):
        resolutions.append(host)
        if host == "gateway.example.com":
            address = "8.8.8.8" if resolutions.count(host) == 1 else "169.254.169.254"
        else:
            address = host
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port or 0))]

    class Socket:
        def __init__(self, *args, **kwargs):
            pass

        def setsockopt(self, *args):
            pass

        def settimeout(self, *args):
            pass

        def close(self):
            pass

        def connect(self, address):
            connects.append(address)
            raise ConnectionRefusedError("synthetic no-network boundary")

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(socket, "socket", Socket)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
                 "YASEIR_GATEWAY_ALLOWED_ORIGINS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        monkeypatch.delenv(name, raising=False)
    return connects, resolutions


def test_config_preflight_cannot_be_rebound_before_connection(socket_boundary):
    connects, resolutions = socket_boundary
    policy = load_module("gateway_destination")
    policy.validate_gateway_host("gateway.example.com", resolve=True)
    with pytest.raises((requests.RequestException, ValueError)):
        production_http().get("https://gateway.example.com/api/odoo/health", timeout=1, allow_redirects=False)
    assert all(address[0] == "8.8.8.8" for address in connects), (
        "The HTTP client connected to a different, forbidden DNS answer after policy validation"
    )


def test_request_connects_only_to_the_validated_numeric_address(socket_boundary):
    connects, resolutions = socket_boundary
    with pytest.raises(requests.RequestException):
        production_http().get("https://gateway.example.com/api/odoo/health", timeout=1, allow_redirects=False)
    assert connects == [("8.8.8.8", 443)]
    assert resolutions.count("gateway.example.com") == 1


def test_environment_proxy_cannot_bypass_the_pinned_destination(socket_boundary, monkeypatch):
    connects, resolutions = socket_boundary
    monkeypatch.setenv("HTTPS_PROXY", "http://169.254.169.254:8080")
    with pytest.raises(requests.RequestException):
        production_http().get("https://gateway.example.com/api/odoo/health", timeout=1)
    assert connects == [("8.8.8.8", 443)]
    assert "169.254.169.254" not in resolutions


@pytest.mark.parametrize("options", [
    {"verify": False}, {"verify": ""}, {"allow_redirects": True},
    {"proxies": {"https": "http://127.0.0.1:8080"}},
    {"timeout": None}, {"timeout": float("inf")}, {"timeout": 61},
])
def test_unsafe_transport_options_fail_before_network(socket_boundary, options):
    connects, resolutions = socket_boundary
    with pytest.raises(requests.RequestException):
        production_http().get("https://gateway.example.com/api/odoo/health", **options)
    assert connects == []
    assert resolutions == []


def test_pinned_pool_keeps_the_original_tls_and_http_authority(monkeypatch):
    transport = load_module("gateway_http")
    adapter = transport._PinnedAdapter(("https", "gateway.example.com", 8443), "8.8.8.8")
    prepared = requests.Request("GET", "https://gateway.example.com:8443/api/odoo/health",
                                headers={"Host": "attacker.invalid"}).prepare()
    observed = {}

    def send(_adapter, request, **kwargs):
        observed.update(host=request.headers["Host"], verify=kwargs["verify"])
        return "sent"

    monkeypatch.setattr(transport.HTTPAdapter, "send", send)
    try:
        pool = adapter.get_connection_with_tls_context(prepared, True)
        assert pool.host == "8.8.8.8"
        assert pool.assert_hostname == "gateway.example.com"
        assert pool.conn_kw["server_hostname"] == "gateway.example.com"
        assert adapter.get_connection(prepared.url) is pool
        assert adapter.send(prepared, verify=True, proxies={}) == "sent"
        assert observed == {"host": "gateway.example.com:8443", "verify": True}
        with pytest.raises(requests.RequestException):
            adapter.get_connection("https://another.example.com:8443/")
    finally:
        adapter.close()


def test_unicode_hostname_matches_requests_idna_normalization():
    transport = load_module("gateway_http")
    assert transport._origin("https://éxample.com/api") == transport._origin("https://xn--xample-9ua.com/api")


@pytest.mark.parametrize("host", ["faß.example", "ß.de", "ς.example", "éxample.com", "xn--fa-hia.example"])
def test_idna_deviation_hosts_match_actual_prepared_request_and_allowlist(host):
    transport = load_module("gateway_http")
    policy = load_module("gateway_destination")
    url = "https://" + host + ":8443/api/odoo/health"
    prepared = requests.Request("GET", url).prepare()
    origin = transport._origin(url)
    assert origin == transport._origin(prepared.url)
    assert policy.origin_is_allowlisted("https://" + host + ":8443", "https://" + origin[1] + ":8443")
    adapter = transport._PinnedAdapter(origin, "8.8.8.8")
    try:
        pool = adapter.get_connection_with_tls_context(prepared, True)
        assert pool.assert_hostname == origin[1]
        assert pool.conn_kw["server_hostname"] == origin[1]
    finally:
        adapter.close()


@pytest.mark.parametrize("scope", [7, 257])
def test_allowlisted_scoped_ipv6_keeps_os_scope_without_changing_tls_name(socket_boundary, monkeypatch, scope):
    connects, resolutions = socket_boundary
    transport = load_module("gateway_http")
    monkeypatch.setenv("YASEIR_GATEWAY_ALLOWED_ORIGINS", "https://gateway.example.com")

    def resolve(host, port, *args, **kwargs):
        resolutions.append(host)
        assert host in ("gateway.example.com", "fe80::1%%%s" % scope)
        return [(socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("fe80::1", port or 0, 0, scope))]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    with pytest.raises(requests.RequestException):
        transport.get("https://gateway.example.com/api/odoo/health", timeout=1)
    assert connects == [("fe80::1", 443, 0, scope)]
    assert resolutions == ["gateway.example.com", "fe80::1%%%s" % scope]
    adapter = transport._PinnedAdapter(("https", "gateway.example.com", 443), "fe80::1%%%s" % scope)
    try:
        assert adapter.pinned_pool.assert_hostname == "gateway.example.com"
        assert adapter.pinned_pool.conn_kw["server_hostname"] == "gateway.example.com"
    finally:
        adapter.close()


def test_temporary_dns_failure_retains_proven_pre_connection_error(socket_boundary, monkeypatch):
    connects, resolutions = socket_boundary
    transport = load_module("gateway_http")
    policy = load_module("gateway_destination")
    def unavailable(*args, **kwargs):
        raise socket.gaierror(-3, "temporary failure")

    monkeypatch.setattr(socket, "getaddrinfo", unavailable)
    with pytest.raises(requests.exceptions.ConnectionError) as failure:
        transport.post("https://gateway.example.com/api/print/jobs", json={"synthetic": True}, timeout=1)
    assert isinstance(failure.value.__cause__, policy.GatewayResolutionError)
    assert isinstance(failure.value.__cause__.__cause__, socket.gaierror)
    assert connects == []
    tree = ast.parse((MODELS / "print_job.py").read_text())
    classifier = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                      and node.name == "_is_pre_dispatch_error")
    classifier.decorator_list = []
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[classifier], type_ignores=[])), "print_job.py", "exec"), namespace)
    assert namespace["_is_pre_dispatch_error"](None, failure.value)


def test_all_gateway_call_sites_use_the_pinned_transport():
    sources = [*MODELS.glob("*.py"), *(MODELS.parent / "controllers").glob("*.py")]
    boundaries = []
    for path in sources:
        if path.name == "gateway_http.py":
            continue
        tree = ast.parse(path.read_text())
        if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
               and isinstance(node.func.value, ast.Name) and node.func.value.id == "requests"
               and node.func.attr in {"get", "post", "patch", "put", "delete", "request"}
               for node in ast.walk(tree)):
            boundaries.append(path.name)
            assert any(isinstance(node, ast.ImportFrom) and
                       any(alias.name == "gateway_http" and alias.asname == "requests" for alias in node.names)
                       for node in tree.body), path.name
    assert set(boundaries) == {"gateway_config.py", "binding.py", "print_job.py", "runtime_printers.py"}
