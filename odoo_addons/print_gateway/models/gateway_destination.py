# -*- coding: utf-8 -*-
"""Side-effect-free Gateway destination policy for Odoo's credential-bearing HTTP.

The origin allowlist comes from the server environment, not from editable Odoo
rows. Without it, public HTTPS hosts remain compatible, while loopback, link
local, metadata and RFC1918/ULA destinations are forbidden. A configured
allowlist is exact (scheme, hostname, port) and can permit a known private
Gateway. Deploy firewall egress restrictions as well: DNS can change between
validation and the subsequent requests connection.
"""

import ipaddress
import socket
from urllib.parse import urlparse


def canonical_origin(value):
    """Parse only a clean HTTP(S) origin; never accept prefix or suffix matches."""
    if not isinstance(value, str):
        raise ValueError("Gateway origin must be a URL")
    parsed = urlparse(value.strip())
    if (
        parsed.scheme.lower() not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Gateway origin must contain only scheme, host and optional port")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Gateway origin has an invalid port") from exc
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("Gateway origin has an invalid port")
    scheme = parsed.scheme.lower()
    return (scheme, parsed.hostname.lower().rstrip("."), port or (443 if scheme == "https" else 80))


def origin_is_allowlisted(value, allowlist):
    """Fail closed on a malformed or nonmatching deployment-managed allowlist.

    No configured allowlist means legacy PUBLIC hosts are accepted, not that
    internal destinations may be used.
    """
    if not allowlist or not allowlist.strip():
        return False
    entries = [part.strip() for part in allowlist.split(",")]
    if not all(entries):
        raise ValueError("YASEIR_GATEWAY_ALLOWED_ORIGINS contains an empty entry")
    try:
        allowed = {canonical_origin(entry) for entry in entries}
    except ValueError as exc:
        raise ValueError("YASEIR_GATEWAY_ALLOWED_ORIGINS contains an invalid origin") from exc
    if canonical_origin(value) not in allowed:
        raise ValueError("Gateway origin is not in YASEIR_GATEWAY_ALLOWED_ORIGINS")
    return True


def is_loopback_host(hostname):
    host = (hostname or "").lower().rstrip(".")
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def validate_gateway_host(hostname, *, resolve=False, allow_private=False):
    """Reject sensitive network destinations before any bearer credential is sent.

    Exact allowlisting grants an explicit exception for intentionally private
    deployments. Normal DNS is checked at request time; OS/network egress
    restrictions remain necessary against DNS rebinding during connect.
    """
    host = (hostname or "").strip().lower().rstrip(".")
    if not host or any(c in host for c in "/\\@?#%"):
        raise ValueError("Gateway hostname is invalid")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        # IPv4-mapped IPv6 literals inherit their embedded IPv4 classification.
        effective_ip = getattr(literal, "ipv4_mapped", None) or literal
        if str(effective_ip) in ("169.254.169.254", "100.100.100.200"):
            raise ValueError("Gateway metadata endpoints are never allowed")
        if literal.is_unspecified or literal.is_multicast:
            raise ValueError("Gateway hostname is not a connectable destination")
        if not effective_ip.is_global and not allow_private:
            raise ValueError("Gateway address is not publicly routable")
        return
    if (
        host == "localhost"
        or host.endswith((".localhost", ".local", ".internal"))
    ) and not allow_private:
        raise ValueError("Gateway hostname is a local or internal destination")
    try:
        ascii_name = host.encode("idna").decode("ascii")
        labels = ascii_name.split(".")
        if (
            len(ascii_name) > 253
            or not all(
                label and len(label) <= 63 and label[0].isalnum()
                and label[-1].isalnum()
                and all(c.isalnum() or c == "-" for c in label)
                for label in labels
            )
        ):
            raise ValueError("Gateway hostname is invalid")
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Gateway hostname is invalid") from exc
    if not resolve:
        return
    try:
        answers = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("Gateway hostname could not be resolved") from exc
    if not answers:
        raise ValueError("Gateway hostname has no network addresses")
    for answer in answers:
        try:
            address = ipaddress.ip_address(answer[4][0])
        except (ValueError, IndexError, TypeError) as exc:
            raise ValueError("Gateway hostname resolved to an invalid address") from exc
        effective_ip = getattr(address, "ipv4_mapped", None) or address
        if str(effective_ip) in ("169.254.169.254", "100.100.100.200"):
            raise ValueError("Gateway hostname resolved to a metadata endpoint")
        if address.is_unspecified or address.is_multicast:
            raise ValueError("Gateway hostname resolved to an unusable address")
        if not effective_ip.is_global and not allow_private:
            raise ValueError("Gateway hostname resolved to an internal network address")
