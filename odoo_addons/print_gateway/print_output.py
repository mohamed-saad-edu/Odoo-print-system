"""Bounded file-artifact evidence; transport success never proves paper output."""
import re


def validated_file_output(value):
    if not isinstance(value, dict) or set(value) != {"output_medium", "artifact_id", "sha256", "page_count", "bytes"}:
        return None
    if value["output_medium"] != "file" or not isinstance(value["artifact_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value["artifact_id"]):
        return None
    if not isinstance(value["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["sha256"]):
        return None
    if type(value["page_count"]) is not int or not 1 <= value["page_count"] <= 10000:
        return None
    if type(value["bytes"]) is not int or not 1 <= value["bytes"] <= 64 * 1024 * 1024:
        return None
    return dict(value)


def gateway_output_values(job, body, status):
    """Project authenticated status metadata; retain a verified artifact forever."""
    medium = body.get("outputMedium")
    current_medium = getattr(job, "output_medium", False)
    if medium not in ("file", "physical"):
        return {}
    if current_medium and medium != current_medium:
        raise ValueError("Gateway output medium changed for the original operation")
    if medium != "file":
        return {"output_medium": medium}
    evidence = validated_file_output(body.get("outputEvidence")) if status == "success" and body.get("outputOutcome") == "file_created" else None
    previous = validated_file_output(getattr(job, "output_evidence", None))
    if previous:
        if evidence and evidence != previous:
            raise ValueError("Gateway file artifact evidence changed for the original operation")
        return {}
    outcome = "file_created" if evidence else "unknown"
    if not evidence and status in ("queued", "submitted", "claimed", "printing") and body.get("outputOutcome") == "pending":
        outcome = "pending"
    elif not evidence and status == "failed" and body.get("outputOutcome") == "not_created":
        outcome = "not_created"
    return {"output_medium": "file", "output_outcome": outcome, "output_evidence": evidence or False}
