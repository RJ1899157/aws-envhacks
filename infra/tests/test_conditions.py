import json
from urllib.parse import parse_qs, urlparse

import pytest

import conditions

AQ_OK = {
    "latitude": 28.6,
    "longitude": 77.2,
    "timezone": "GMT",
    "current_units": {"time": "iso8601", "interval": "seconds", "pm2_5": "μg/m³"},
    "current": {"time": "2026-10-11T07:00", "interval": 3600, "pm2_5": 143.2},
}
WX_OK = {
    "current_units": {"temperature_2m": "°C", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
    "current": {"time": "2026-10-11T07:15", "interval": 900, "temperature_2m": 29.1, "wind_speed_10m": 2.3, "wind_direction_10m": 310},
}


def fake_fetch(aq=AQ_OK, wx=WX_OK, calls=None):
    """Routes by host; a value that is an Exception is raised instead of returned."""

    def fetch(url, timeout=None):
        if calls is not None:
            calls.append(url)
        result = aq if "air-quality-api" in url else wx
        if isinstance(result, Exception):
            raise result
        return result

    return fetch


def event(**qs):
    return {"queryStringParameters": {k: str(v) for k, v in qs.items()} or None}


# --- lat/lon validation and rounding ---------------------------------------------------------


@pytest.mark.parametrize(
    "params,expected",
    [
        ({"lat": "28.6139", "lon": "77.2090"}, (28.61, 77.21)),
        ({"lat": "-90", "lon": "180"}, (-90.0, 180.0)),
        ({"lat": "90", "lon": "-180"}, (90.0, -180.0)),
        ({"lat": "-0.001", "lon": "0.004"}, (0.0, 0.0)),
        ({"latitude": "19.07609", "longitude": "72.877426"}, (19.08, 72.88)),
    ],
)
def test_parse_location_valid(params, expected):
    assert conditions.parse_location(params) == expected


@pytest.mark.parametrize(
    "params",
    [None, {}, {"lat": "28.6"}, {"lon": "77.2"}, {"lat": "90.01", "lon": "0"}, {"lat": "-91", "lon": "0"},
     {"lat": "0", "lon": "180.5"}, {"lat": "0", "lon": "-181"}, {"lat": "abc", "lon": "1"}, {"lat": "nan", "lon": "1"},
     {"lat": "inf", "lon": "1"}, {"lat": "", "lon": ""}],
)
def test_parse_location_invalid(params):
    with pytest.raises(ValueError):
        conditions.parse_location(params)


def test_invalid_location_returns_400_json():
    res = conditions.handler(event(lat=95, lon=10), fetch=fake_fetch())
    assert res["statusCode"] == 400
    body = json.loads(res["body"])
    assert body["error"] is True and "lat" in body["reason"]


def test_cache_key_uses_rounded_coordinates():
    assert conditions.cache_key(*conditions.parse_location({"lat": "28.6139", "lon": "77.2090"})) == "cond#28.61#77.21"
    assert conditions.cache_key(*conditions.parse_location({"lat": "28.6101", "lon": "77.2149"})) == "cond#28.61#77.21"
    assert conditions.cache_key(*conditions.parse_location({"lat": "-0.001", "lon": "5"})) == "cond#0.00#5.00"


# --- Open-Meteo URLs and parsing -------------------------------------------------------------


def test_upstream_urls_use_documented_parameters():
    aq = parse_qs(urlparse(conditions.air_quality_url(28.61, 77.21)).query)
    assert aq == {"latitude": ["28.61"], "longitude": ["77.21"], "current": ["pm2_5"]}
    wx = parse_qs(urlparse(conditions.forecast_url(28.61, 77.21)).query)
    assert wx["current"] == ["temperature_2m,wind_speed_10m,wind_direction_10m"]
    assert wx["wind_speed_unit"] == ["ms"]


def test_parse_air_quality():
    assert conditions.parse_air_quality(AQ_OK) == {"time": "2026-10-11T07:00", "pm2_5": 143.2}
    for bad in [{"error": True, "reason": "Latitude must be in range"}, {"current": {"pm2_5": None}}, {"current": {"pm2_5": -1}}, {}, None]:
        with pytest.raises(conditions.UpstreamError):
            conditions.parse_air_quality(bad)


def test_parse_weather_keeps_meteorological_direction():
    assert conditions.parse_weather(WX_OK) == {"time": "2026-10-11T07:15", "temperatureC": 29.1, "windSpeedMs": 2.3, "windDirDeg": 310}
    with pytest.raises(conditions.UpstreamError):
        conditions.parse_weather({"current": {"temperature_2m": 20}})


# --- response shape and failures -------------------------------------------------------------


def test_response_shape_on_success():
    res = conditions.handler(event(lat="28.6139", lon="77.2090"), fetch=fake_fetch())
    assert res["statusCode"] == 200
    assert res["headers"]["content-type"] == "application/json"
    assert json.loads(res["body"]) == {
        "current": {"time": "2026-10-11T07:00", "pm2_5": 143.2},
        "weather": {"time": "2026-10-11T07:15", "temperatureC": 29.1, "windSpeedMs": 2.3, "windDirDeg": 310},
        "location": {"lat": 28.61, "lon": 77.21},
        "source": "open-meteo",
        "cached": False,
    }


def test_weather_failure_still_returns_pm25(monkeypatch, fake_table):
    monkeypatch.setattr(conditions, "_table", fake_table)
    res = conditions.handler(event(lat=28.61, lon=77.21), fetch=fake_fetch(wx=conditions.UpstreamError("HTTP 500")))
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["current"]["pm2_5"] == 143.2
    assert body["weather"] is None
    assert fake_table.puts == 0  # partial results aren't cached


def test_weather_bad_payload_still_returns_pm25():
    res = conditions.handler(event(lat=28.61, lon=77.21), fetch=fake_fetch(wx={"current": {}}))
    assert res["statusCode"] == 200 and json.loads(res["body"])["weather"] is None


def test_pm25_failure_returns_502():
    res = conditions.handler(event(lat=28.61, lon=77.21), fetch=fake_fetch(aq=conditions.UpstreamError("network error: timed out")))
    assert res["statusCode"] == 502
    body = json.loads(res["body"])
    assert body["error"] is True and "timed out" in body["reason"]


def test_cache_hit_skips_upstream(monkeypatch, fake_table):
    monkeypatch.setattr(conditions, "_table", fake_table)
    first = conditions.handler(event(lat="28.6139", lon="77.2090"), fetch=fake_fetch())
    assert json.loads(first["body"])["cached"] is False
    assert "cond#28.61#77.21" in fake_table.items
    assert fake_table.items["cond#28.61#77.21"]["expiresAt"] > 0

    calls = []
    second = conditions.handler(event(lat="28.612", lon="77.208"), fetch=fake_fetch(calls=calls))
    assert calls == []
    body = json.loads(second["body"])
    assert body["cached"] is True and body["current"]["pm2_5"] == 143.2


def test_expired_cache_item_is_ignored(monkeypatch, fake_table):
    monkeypatch.setattr(conditions, "_table", fake_table)
    fake_table.items["cond#28.61#77.21"] = {"pk": "cond#28.61#77.21", "payload": json.dumps({"stale": True}), "expiresAt": 1}
    res = conditions.handler(event(lat=28.61, lon=77.21), fetch=fake_fetch())
    assert json.loads(res["body"])["cached"] is False


def test_fetch_json_wraps_network_errors(monkeypatch):
    import urllib.error

    def boom(*a, **k):
        raise urllib.error.URLError("timed out")

    monkeypatch.setattr(conditions.urllib.request, "urlopen", boom)
    with pytest.raises(conditions.UpstreamError):
        conditions.fetch_json("https://example.invalid")
