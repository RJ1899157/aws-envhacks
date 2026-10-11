"""GET /conditions?lat=..&lon=..: current outdoor PM2.5 and weather from Open-Meteo, cached in DynamoDB.

The `current` block keeps Open-Meteo's own shape ({ time, pm2_5 }) so the frontend's existing
Open-Meteo parser can read this response unchanged. Standard library only (plus boto3, which the
Lambda runtime provides, for the cache).
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

TABLE_NAME = os.environ.get("TABLE_NAME", "")
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "1800"))
HTTP_TIMEOUT_SECONDS = float(os.environ.get("HTTP_TIMEOUT_SECONDS", "8"))

_table = None


class UpstreamError(Exception):
    pass


def _get_table():
    global _table
    if _table is None and TABLE_NAME:
        import boto3

        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def error(status, reason):
    return response(status, {"error": True, "reason": reason})


def _number(value):
    """Finite float from a query-string value, or None."""
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def parse_location(params):
    """(lat, lon) rounded to 2 decimals, or raises ValueError with a reason.

    Accepts `lat`/`lon`, and `latitude`/`longitude` so the frontend's Open-Meteo provider can use
    this endpoint as a drop-in `baseUrl`.
    """
    params = params or {}
    raw_lat = params.get("lat", params.get("latitude"))
    raw_lon = params.get("lon", params.get("longitude"))
    lat = _number(raw_lat)
    lon = _number(raw_lon)
    if lat is None or not -90 <= lat <= 90:
        raise ValueError("lat must be a number between -90 and 90")
    if lon is None or not -180 <= lon <= 180:
        raise ValueError("lon must be a number between -180 and 180")
    # +0.0 avoids "-0.0" in cache keys and responses
    return round(lat, 2) + 0.0, round(lon, 2) + 0.0


def cache_key(lat, lon):
    return f"cond#{lat:.2f}#{lon:.2f}"


def fetch_json(url, timeout=HTTP_TIMEOUT_SECONDS):
    """GET a JSON document; raises UpstreamError on HTTP, network, timeout or decode errors."""
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "airforce-backend/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        reason = ""
        try:
            reason = json.loads(e.read().decode("utf-8")).get("reason", "")
        except Exception:
            pass
        raise UpstreamError(f"HTTP {e.code}{': ' + reason if reason else ''}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UpstreamError(f"network error: {getattr(e, 'reason', e)}") from e
    except ValueError as e:
        raise UpstreamError("invalid JSON") from e


def air_quality_url(lat, lon):
    return f"{AIR_QUALITY_URL}?" + urllib.parse.urlencode({"latitude": lat, "longitude": lon, "current": "pm2_5"})


def forecast_url(lat, lon):
    return f"{FORECAST_URL}?" + urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,wind_speed_10m,wind_direction_10m",
            "wind_speed_unit": "ms",
        }
    )


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def parse_air_quality(body):
    """{ time, pm2_5 } from an Open-Meteo air-quality response, or raises UpstreamError."""
    if not isinstance(body, dict) or body.get("error"):
        raise UpstreamError((body or {}).get("reason") or "air-quality API returned an error")
    current = body.get("current") or {}
    pm = current.get("pm2_5")
    if not _finite(pm) or pm < 0:
        raise UpstreamError("air-quality response has no current pm2_5 value")
    return {"time": current.get("time"), "pm2_5": pm}


def parse_weather(body):
    """{ time, temperatureC, windSpeedMs, windDirDeg } from an Open-Meteo forecast response, or raises UpstreamError.

    windDirDeg is meteorological: the direction the wind blows FROM, as Open-Meteo returns it.
    """
    if not isinstance(body, dict) or body.get("error"):
        raise UpstreamError((body or {}).get("reason") or "forecast API returned an error")
    current = body.get("current") or {}
    t, ws, wd = current.get("temperature_2m"), current.get("wind_speed_10m"), current.get("wind_direction_10m")
    if not (_finite(t) and _finite(ws) and _finite(wd)):
        raise UpstreamError("forecast response is missing current values")
    return {"time": current.get("time"), "temperatureC": t, "windSpeedMs": ws, "windDirDeg": wd}


def get_conditions(lat, lon, fetch=fetch_json):
    """Live lookup. Returns (body, complete); raises UpstreamError when PM2.5 is unavailable.

    A weather failure still returns PM2.5 with "weather": null (complete=False, so it isn't cached).
    """
    current = parse_air_quality(fetch(air_quality_url(lat, lon)))
    weather = None
    try:
        weather = parse_weather(fetch(forecast_url(lat, lon)))
    except UpstreamError as e:
        print(json.dumps({"route": "conditions", "warn": "weather unavailable", "detail": str(e)[:120]}))
    body = {
        "current": current,
        "weather": weather,
        "location": {"lat": lat, "lon": lon},
        "source": "open-meteo",
        "cached": False,
    }
    return body, weather is not None


def cache_get(key, now=None):
    table = _get_table()
    if table is None:
        return None
    try:
        item = table.get_item(Key={"pk": key}).get("Item")
    except Exception as e:  # cache problems never fail the request
        print(json.dumps({"route": "conditions", "warn": "cache read failed", "detail": type(e).__name__}))
        return None
    # DynamoDB TTL deletion is lazy, so expired items can still be returned
    if not item or int(item.get("expiresAt", 0)) <= int(now or time.time()):
        return None
    return json.loads(item["payload"])


def cache_put(key, body, now=None):
    table = _get_table()
    if table is None:
        return
    try:
        table.put_item(
            Item={"pk": key, "payload": json.dumps(body, ensure_ascii=False), "expiresAt": int(now or time.time()) + CACHE_TTL_SECONDS}
        )
    except Exception as e:
        print(json.dumps({"route": "conditions", "warn": "cache write failed", "detail": type(e).__name__}))


def handler(event, context=None, fetch=fetch_json):
    t0 = time.perf_counter()
    status, cache = 200, "miss"
    try:
        try:
            lat, lon = parse_location((event or {}).get("queryStringParameters"))
        except ValueError as e:
            status = 400
            return error(400, str(e))

        key = cache_key(lat, lon)
        hit = cache_get(key)
        if hit is not None:
            cache = "hit"
            return response(200, {**hit, "cached": True})

        try:
            body, complete = get_conditions(lat, lon, fetch)
        except UpstreamError as e:
            status = 502
            return error(502, f"PM2.5 lookup failed: {e}")
        if complete:
            cache_put(key, body)
        return response(200, body)
    finally:
        # No coordinates in logs
        print(json.dumps({"route": "conditions", "status": status, "cache": cache, "ms": round((time.perf_counter() - t0) * 1000)}))
