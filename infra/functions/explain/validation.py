"""Strict validation of the POST /explain body, normalization and cache key."""

import base64
import hashlib
import json
import math

MAX_BODY_BYTES = 8192
EFFORTS = {"Free", "Low", "Purchase"}
VERIFIED = {"verified", "disagrees", "unverified", "pending"}

MAX_STR = 300
MAX_ITEMS = 20


class InvalidInput(ValueError):
    pass


def _num(v, name, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise InvalidInput(f"{name} must be a number")
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise InvalidInput(f"{name} is out of range")
    return v


def _str(v, name, max_len=MAX_STR):
    if not isinstance(v, str) or not v.strip():
        raise InvalidInput(f"{name} must be a non-empty string")
    if len(v) > max_len:
        raise InvalidInput(f"{name} is too long")
    return v


def _list(v, name, min_items=0, max_items=MAX_ITEMS):
    if not isinstance(v, list):
        raise InvalidInput(f"{name} must be a list")
    if not min_items <= len(v) <= max_items:
        raise InvalidInput(f"{name} must have {min_items}-{max_items} items")
    return v


def _keys(obj, name, required, optional=()):
    if not isinstance(obj, dict):
        raise InvalidInput(f"{name} must be an object")
    extra = set(obj) - set(required) - set(optional)
    if extra:
        raise InvalidInput(f"unexpected field in {name}: {sorted(extra)[0]}")
    missing = [k for k in required if k not in obj]
    if missing:
        raise InvalidInput(f"missing field in {name}: {missing[0]}")


def read_body(event, max_bytes=MAX_BODY_BYTES):
    """Raw request body as bytes; raises InvalidInput if missing or too large."""
    body = (event or {}).get("body")
    if body is None or body == "":
        raise InvalidInput("request body is required")
    raw = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode("utf-8")
    if len(raw) > max_bytes:
        raise InvalidInput(f"request body is larger than {max_bytes} bytes")
    return raw


def validate(payload):
    """Returns the payload if it matches the /explain schema exactly; raises InvalidInput otherwise."""
    _keys(payload, "body", ["objective", "action", "outdoorPm25"])
    _str(payload["objective"], "objective", 80)
    _num(payload["outdoorPm25"], "outdoorPm25", 0, 5000)

    a = payload["action"]
    _keys(a, "action", ["texts", "effort", "before", "after", "fraction", "roomDeltas", "facts", "verified"])
    for i, t in enumerate(_list(a["texts"], "action.texts", 1, 10)):
        _str(t, f"action.texts[{i}]")
    if a["effort"] not in EFFORTS:
        raise InvalidInput("action.effort must be Free, Low or Purchase")
    _num(a["before"], "action.before", 0, 100000)
    _num(a["after"], "action.after", 0, 100000)
    _num(a["fraction"], "action.fraction", -1, 100)
    for i, d in enumerate(_list(a["roomDeltas"], "action.roomDeltas")):
        _keys(d, f"action.roomDeltas[{i}]", ["name", "before", "after"])
        _str(d["name"], f"action.roomDeltas[{i}].name", 80)
        _num(d["before"], f"action.roomDeltas[{i}].before", 0, 100000)
        _num(d["after"], f"action.roomDeltas[{i}].after", 0, 100000)
    for i, f in enumerate(_list(a["facts"], "action.facts")):
        _str(f, f"action.facts[{i}]")
    if a["verified"] not in VERIFIED:
        raise InvalidInput("action.verified must be verified, disagrees, unverified or pending")
    return payload


def parse(raw):
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise InvalidInput("body must be valid JSON") from e
    return validate(payload)


def normalized_json(payload):
    """Canonical JSON: sorted keys, no whitespace, so equal bodies hash equally."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def cache_key(payload):
    return "explain#v1#" + hashlib.sha256(normalized_json(payload).encode("utf-8")).hexdigest()
