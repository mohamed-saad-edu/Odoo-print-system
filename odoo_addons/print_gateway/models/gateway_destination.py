# -*- coding: utf-8 -*-
"""Side-effect-free Gateway destination policy for Odoo's credential-bearing HTTP.

The origin allowlist comes from the server environment, not from editable Odoo
rows. Without it, public HTTPS hosts remain compatible, while loopback, link
local, metadata and RFC1918/ULA destinations are forbidden. A configured
allowlist is exact (scheme, hostname, port) and can permit a known private
Gateway. The HTTP transport consumes the validated addresses directly rather
than resolving the hostname again when it connects.
"""

import ipaddress
import socket
from urllib.parse import urlparse

import idna


class GatewayResolutionError(ValueError):
    """Name resolution failed before any socket or request could be created."""


def canonical_hostname(hostname):
    """Use the same UTS46/IDNA2008 spelling as Requests' PreparedRequest."""
    host = (hostname or "").lower().rstrip(".")
    if not host or "%" in host:
        raise ValueError("Gateway hostname is invalid")
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        try:
            return idna.encode(host, uts46=True).decode("ascii").rstrip(".")
        except idna.IDNAError as exc:
            raise ValueError("Gateway hostname is invalid") from exc


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
    return (scheme, canonical_hostname(parsed.hostname), port or (443 if scheme == "https" else 80))


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
    deployments. With ``resolve=True``, return the validated numeric addresses
    so the request-local HTTP transport can pin its connection to an answer.
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
        return (str(literal),)
    host = canonical_hostname(host)
    if (
        host == "localhost"
        or host.endswith((".localhost", ".local", ".internal"))
    ) and not allow_private:
        raise ValueError("Gateway hostname is a local or internal destination")
    try:
        ascii_name = host
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
        answers = socket.getaddrinfo(ascii_name, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise GatewayResolutionError("Gateway hostname could not be resolved") from exc
    if not answers:
        raise ValueError("Gateway hostname has no network addresses")
    if len(answers) > 64:
        raise ValueError("Gateway hostname returned too many network addresses")
    addresses = []
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
        target = str(address)
        if answer[0] == socket.AF_INET6:
            try:
                scope = answer[4][3]
            except (IndexError, TypeError) as exc:
                raise ValueError("Gateway hostname returned an invalid IPv6 scope") from exc
            if type(scope) is not int or not 0 <= scope <= 0xFFFFFFFF:
                raise ValueError("Gateway hostname returned an invalid IPv6 scope")
            if scope:
                # The zone is a numeric OS resolver scope, never URL input.
                # Keep it only after the underlying IP passes all admission
                # rules, including the explicit private-origin allowlist.
                target += "%%%d" % scope
        if target not in addresses:
            addresses.append(target)
    return tuple(addresses)
