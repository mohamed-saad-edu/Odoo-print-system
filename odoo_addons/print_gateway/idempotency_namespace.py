# -*- coding: utf-8 -*-
"""Immutable v1/v2 Gateway identity contract; pure Python for preflight testing.

v1 bytes are a historical wire contract. v2 is issued only after operator
registration/cutover, never inferred from a copied Odoo database UUID. This
module does not provision or activate an installation.
"""
import hashlib
import json
import re
import uuid

_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")


def legacy_key(company_id, operation_id):
    return hashlib.sha256(("odoo:%s:%s" % (company_id, operation_id)).encode("utf-8")).hexdigest()


def require_v2_identity(installation_id, secret):
    try:
        parsed = uuid.UUID(str(installation_id))
        if parsed.version != 4 or str(parsed) != installation_id:
            raise ValueError("Installation identity must be a canonical UUID v4")
    except (TypeError, AttributeError, ValueError) as exc:
        raise ValueError("Operator-enrolled installation identity is required") from exc
    if not isinstance(secret, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", secret):
        raise ValueError("An independently provisioned installation proof is required")
    return str(parsed)


def wire_key(version, company_id, operation_id, installation_id=None):
    if version == 1:
        # Never add a new restriction to a previously persisted v1 business
        # key. Historical rows must keep byte-identical Gateway identities.
        return legacy_key(company_id, operation_id)
    if version != 2:
        raise ValueError("Unsupported print idempotency namespace version")
    if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 200:
        raise ValueError("Durable local operation key is required")
    try:
        parsed = uuid.UUID(str(installation_id))
        if parsed.version != 4 or str(parsed) != installation_id:
            raise ValueError("Invalid installation identity")
    except (TypeError, AttributeError, ValueError) as exc:
        raise ValueError("Registered installation identity is required") from exc
    parts = ["yaseir-odoo-v2", str(parsed), str(company_id), operation_id]
    raw = json.dumps(parts, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def deployment_proof(installation_id):
    """Read enrollment proof from the Odoo PROCESS environment, never database.

    Supports several Odoo DBs in one service via an out-of-DB UUID->proof map.
    A restored/cloned database with no external proof must not self-enroll.
    """
    import os

    raw = os.environ.get("YASEIR_ODOO_INSTALLATION_PROOFS", "")
    if raw:
        try:
            mapping = json.loads(raw)
        except (TypeError, ValueError):
            raise ValueError("Invalid external Odoo installation enrollment configuration") from None
        if not isinstance(mapping, dict):
            raise ValueError("External Odoo installation enrollment must be a mapping")
        proof = mapping.get(installation_id)
    else:
        proof = os.environ.get("YASEIR_ODOO_INSTALLATION_PROOF")
    require_v2_identity(installation_id, proof)
    return proof
