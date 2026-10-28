"""Strict, side-effect-free reader for the shared printer geometry v1 contract.

Only the Agent reports measurements. Odoo never infers printable dots from a
nominal roll width, printer name, protocol label, or browser defaults.
"""
from datetime import datetime
import math
import re


def validated_printer_geometry(value, printer_id=None, fingerprint=None):
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
        return None
    expected_validation = {"windows_driver": "observed", "ipp": "observed", "validated_profile": "configured"}
    if value.get("source") not in expected_validation or value.get("validation") != expected_validation[value["source"]]:
        return None
    identity = value.get("printer_id")
    # Geometry cannot authorize a printer identity the Gateway and Go Agent
    # cannot execute. Their opaque ID boundary is 120 UTF-8 bytes, not
    # Python characters or UTF-16 units. Never trim or repair an identifier.
    if (not isinstance(identity, str) or not identity or identity != identity.strip()
            or identity.startswith("\ufeff") or identity.endswith("\ufeff")
            or re.search(r"[\x00-\x1f\x7f-\x9f]", identity)
            or (printer_id is not None and identity != printer_id)):
        return None
    try:
        if len(identity.encode("utf-8", "strict")) > 120:
            return None
    except UnicodeEncodeError:
        return None
    actual_fingerprint = value.get("config_fingerprint")
    if not isinstance(actual_fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", actual_fingerprint) or (fingerprint is not None and actual_fingerprint != fingerprint):
        return None
    observed_at = value.get("observed_at")
    if not isinstance(observed_at, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z", observed_at):
        return None
    try:
        datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    integer_fields = {
        "printable_width_dots": (1, 16384), "printable_height_dots": (1, 1000000),
        "dpi_x": (1, 9600), "dpi_y": (1, 9600),
        "offset_x_dots": (0, 1000000), "offset_y_dots": (0, 1000000),
    }
    allowed_keys = set(integer_fields) | {"version", "source", "validation", "observed_at", "printer_id", "config_fingerprint", "paper_width_mm", "paper_height_mm", "raster_command"}
    if set(value) - allowed_keys:
        return None
    if "printable_width_dots" not in value:
        return None
    result = {key: value[key] for key in ("version", "source", "validation", "observed_at", "printer_id", "config_fingerprint")}
    for key, (minimum, maximum) in integer_fields.items():
        if key in value:
            number = value[key]
            if type(number) is not int or not minimum <= number <= maximum:
                return None
            result[key] = number
    for key in ("paper_width_mm", "paper_height_mm"):
        if key in value:
            number = value[key]
            if type(number) not in (int, float) or not 0 < number <= 10000 or not math.isfinite(number):
                return None
            result[key] = number
    if "raster_command" in value:
        if value["raster_command"] != "gs_v_0":
            return None
        result["raster_command"] = "gs_v_0"
    for size, dpi, printable, offset in (
        ("paper_width_mm", "dpi_x", "printable_width_dots", "offset_x_dots"),
        ("paper_height_mm", "dpi_y", "printable_height_dots", "offset_y_dots"),
    ):
        if all(key in result for key in (size, dpi, printable)):
            if result[printable] + result.get(offset, 0) > result[size] * result[dpi] / 25.4 + 1:
                return None
    return result


def validated_receipt_geometry(value, printer_id=None):
    result = validated_printer_geometry(value, printer_id)
    if result is None or any(key not in result for key in ("dpi_x", "dpi_y")):
        return None
    return result


def validated_page_geometry(value, printer_id=None):
    result = validated_receipt_geometry(value, printer_id)
    required = ("paper_width_mm", "paper_height_mm", "printable_height_dots", "offset_x_dots", "offset_y_dots")
    return result if result is not None and all(key in result for key in required) else None
