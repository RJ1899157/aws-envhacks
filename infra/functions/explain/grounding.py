"""Grounding check: every number in the model's text must be derivable from the request.

Allowed values (compared as absolute values, so "−56" and "56" are the same):
  * any number in the input (fields and numbers inside its strings), rounded to 0 or 1 decimals
  * abs(fraction) x 100, rounded to 0 or 1 decimals
  * each room's abs((after - before) / before) x 100, rounded the same way
  * the before-to-after drop (overall and per room), rounded the same way
  * small counts 1-3
"""

import math
import re

# "PM2.5", "PM 2.5", "PM10" name the pollutant, not a quantity
_POLLUTANT = re.compile(r"\bPM\s?(?:2[.,]5|10)\b", re.IGNORECASE)
# 1,234.5 / 245.6 / 23 (ASCII digits only, so "m³" doesn't count)
_NUMBER = re.compile(r"(?<![0-9.])[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?")

SMALL_COUNTS = {1.0, 2.0, 3.0}


def extract_numbers(text):
    text = _POLLUTANT.sub(" ", text or "")
    return [float(m.group(0).replace(",", "")) for m in _NUMBER.finditer(text)]


def _half_up(x, places):
    q = 10**places
    return math.floor(abs(x) * q + 0.5) / q


def _variants(x):
    x = abs(x)
    return {_half_up(x, 0), _half_up(x, 1), round(x), round(x, 1)}


def _walk_numbers(value):
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield float(value)
    elif isinstance(value, str):
        yield from extract_numbers(value)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _walk_numbers(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk_numbers(v)


def allowed_numbers(payload):
    action = payload["action"]
    base = list(_walk_numbers(payload))
    base.append(abs(action["fraction"]) * 100)
    base.append(action["before"] - action["after"])
    if action["before"] > 0:
        base.append((action["after"] - action["before"]) / action["before"] * 100)
    for d in action["roomDeltas"]:
        base.append(d["before"] - d["after"])
        if d["before"] > 0:
            base.append((d["after"] - d["before"]) / d["before"] * 100)
    allowed = set(SMALL_COUNTS)
    for x in base:
        allowed |= _variants(x)
    return allowed


def ungrounded_numbers(text, payload):
    """Numbers in `text` that can't be derived from `payload` (empty list = grounded)."""
    allowed = allowed_numbers(payload)
    return [n for n in extract_numbers(text) if round(n, 1) not in allowed]


def is_grounded(text, payload):
    return not ungrounded_numbers(text, payload)
