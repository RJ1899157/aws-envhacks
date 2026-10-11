import base64
import copy
import json

import pytest

import explain
import grounding
import validation

GOOD_TEXT = (
    "Adding an air purifier and closing the north window stops smoky outdoor air from coming into Bedroom 1. "
    "This brings its PM2.5 down from 244.6 to 189.0 µg/m³, about 23% lower."
)


def event(body, b64=False):
    raw = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    if b64:
        return {"body": base64.b64encode(raw.encode()).decode(), "isBase64Encoded": True}
    return {"body": raw, "isBase64Encoded": False}


class FakeModel:
    """Returns queued answers in order and records the system prompts it was given."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.systems = []

    def __call__(self, system_prompt, prompt):
        self.systems.append(system_prompt)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


# --- input validation ------------------------------------------------------------------------


def test_sample_event_is_valid(explain_body):
    assert validation.validate(explain_body) is explain_body


def _mutations():
    def setp(path, value):
        def f(b):
            obj = b
            for k in path[:-1]:
                obj = obj[k]
            if value is KeyError:
                del obj[path[-1]]
            else:
                obj[path[-1]] = value
        return f

    return {
        "missing objective": setp(["objective"], KeyError),
        "empty objective": setp(["objective"], "  "),
        "extra top field": lambda b: b.update(extra=1),
        "extra action field": lambda b: b["action"].update(delta=-5),
        "bad effort": setp(["action", "effort"], "Expensive"),
        "bad verified": setp(["action", "verified"], "yes"),
        "string before": setp(["action", "before"], "244.6"),
        "bool after": setp(["action", "after"], True),
        "negative pm": setp(["outdoorPm25"], -1),
        "fraction too small": setp(["action", "fraction"], -1.5),
        "texts empty": setp(["action", "texts"], []),
        "texts not strings": setp(["action", "texts"], [1]),
        "facts not list": setp(["action", "facts"], "x"),
        "room delta extra": lambda b: b["action"]["roomDeltas"][0].update(delta=1),
        "room delta missing": lambda b: b["action"]["roomDeltas"][0].pop("after"),
        "long text": setp(["action", "texts"], ["x" * 301]),
        "action not object": setp(["action"], []),
    }


@pytest.mark.parametrize("name", list(_mutations()))
def test_invalid_input_rejected(name, explain_body):
    body = copy.deepcopy(explain_body)
    _mutations()[name](body)
    model = FakeModel()
    res = explain.handler(event(body), model_call=model)
    assert res["statusCode"] == 400
    assert json.loads(res["body"])["error"] is True
    assert model.systems == []


@pytest.mark.parametrize("raw", ["", "not json", "[]", "null", '{"objective": "Whole house"}'])
def test_malformed_body_rejected(raw):
    assert explain.handler({"body": raw}, model_call=FakeModel())["statusCode"] == 400


def test_missing_body_rejected():
    assert explain.handler({}, model_call=FakeModel())["statusCode"] == 400


def test_body_over_8kb_rejected(explain_body):
    body = copy.deepcopy(explain_body)
    body["action"]["facts"] = ["f" * 300] * 20
    body["action"]["texts"] = ["t" * 300] * 10
    raw = json.dumps(body)
    assert len(raw) > 8192
    res = explain.handler(event(raw), model_call=FakeModel())
    assert res["statusCode"] == 400 and "8192" in json.loads(res["body"])["reason"]


def test_base64_body_accepted(explain_body):
    res = explain.handler(event(explain_body, b64=True), model_call=FakeModel(GOOD_TEXT))
    assert res["statusCode"] == 200


# --- cache key -------------------------------------------------------------------------------


def test_cache_key_stable_across_key_order_and_whitespace(explain_body):
    reordered = json.loads(json.dumps(explain_body, sort_keys=True))
    reordered = {k: reordered[k] for k in reversed(list(reordered))}
    pretty = json.dumps(reordered, indent=4)
    k1 = validation.cache_key(explain_body)
    k2 = validation.cache_key(validation.parse(pretty))
    assert k1 == k2
    assert k1.startswith("explain#v1#") and len(k1) == len("explain#v1#") + 64


def test_cache_key_changes_with_content(explain_body):
    other = copy.deepcopy(explain_body)
    other["action"]["after"] = 190.0
    assert validation.cache_key(other) != validation.cache_key(explain_body)


# --- grounding -------------------------------------------------------------------------------


def test_extract_numbers_ignores_pollutant_name_and_superscripts():
    assert grounding.extract_numbers("PM2.5 fell from 244.6 to 189 µg/m³ (PM 2.5, PM10), 1,200 m³/h") == [244.6, 189.0, 1200.0]


def test_grounding_passes_on_correct_numbers(explain_body):
    assert grounding.ungrounded_numbers(GOOD_TEXT, explain_body) == []
    # rounded input values, the 22.7% fraction, the 56 µg/m³ drop, input facts, and small counts
    assert grounding.is_grounded("It drops from 245 to 189, a 22.7% cut of 55.6, with 300 m³/h; 2 steps; outdoor is 250.", explain_body)


def test_grounding_accepts_room_fraction(explain_body):
    body = copy.deepcopy(explain_body)
    body["objective"] = "Whole house"
    body["action"]["roomDeltas"] = [{"name": "Kitchen", "before": 200.0, "after": 150.0}]
    assert grounding.is_grounded("The kitchen improves by 25%.", body)


def test_grounding_fails_on_invented_number(explain_body):
    assert grounding.ungrounded_numbers("PM2.5 drops from 244.6 to 189.0, cutting asthma risk by 70%.", explain_body) == [70.0]
    assert not grounding.is_grounded("A purifier costs about 8000 rupees.", explain_body)
    assert not grounding.is_grounded("It falls to 188.0.", explain_body)


# --- handler flow ----------------------------------------------------------------------------


def test_success_response_shape_and_cache(monkeypatch, fake_table, explain_body):
    monkeypatch.setattr(explain, "_table", fake_table)
    res = explain.handler(event(explain_body), model_call=FakeModel(GOOD_TEXT))
    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"text": GOOD_TEXT, "model": explain.MODEL_ID, "cached": False}
    assert fake_table.puts == 1

    again = explain.handler(event(json.dumps(explain_body, indent=2)), model_call=FakeModel())
    assert json.loads(again["body"]) == {"text": GOOD_TEXT, "model": explain.MODEL_ID, "cached": True}


def test_retry_once_with_stricter_prompt(explain_body):
    model = FakeModel("It cuts PM2.5 by 70%.", GOOD_TEXT)
    res = explain.handler(event(explain_body), model_call=model)
    assert json.loads(res["body"])["text"] == GOOD_TEXT
    assert len(model.systems) == 2
    assert "70" in model.systems[1] and model.systems[1].startswith(explain.SYSTEM_PROMPT)


def test_ungrounded_twice_returns_null_and_is_not_cached(monkeypatch, fake_table, explain_body):
    monkeypatch.setattr(explain, "_table", fake_table)
    res = explain.handler(event(explain_body), model_call=FakeModel("It cuts PM2.5 by 70%.", "Costs 5000 rupees."))
    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"text": None, "reason": "ungrounded"}
    assert fake_table.puts == 0


def test_model_error_returns_502(explain_body):
    res = explain.handler(event(explain_body), model_call=FakeModel(explain.ModelError("ReadTimeoutError")))
    assert res["statusCode"] == 502
    assert json.loads(res["body"]) == {"error": True, "reason": "model call failed: ReadTimeoutError"}


def test_call_model_wraps_sdk_errors(monkeypatch):
    class Boom:
        def __init__(self, **kwargs):
            pass

        def __call__(self, prompt):
            raise TimeoutError("read timeout")

    monkeypatch.setattr(explain, "Agent", Boom)
    monkeypatch.setattr(explain, "_get_model", lambda: object())
    with pytest.raises(explain.ModelError):
        explain.call_model("sys", "prompt")


def test_call_model_uses_fresh_strands_agent(monkeypatch):
    seen = []

    class FakeAgent:
        def __init__(self, **kwargs):
            seen.append(kwargs)

        def __call__(self, prompt):
            return "  Some text.  "

    monkeypatch.setattr(explain, "Agent", FakeAgent)
    monkeypatch.setattr(explain, "_get_model", lambda: "model")
    assert explain.call_model("sys", "p") == "Some text."
    assert explain.call_model("sys", "p") == "Some text."
    assert len(seen) == 2
    assert seen[0]["system_prompt"] == "sys" and seen[0]["callback_handler"] is None and seen[0]["model"] == "model"


def test_bedrock_model_config(monkeypatch):
    """The real BedrockModel is configured from env without any network call."""
    monkeypatch.setattr(explain, "_model", None)
    model = explain._get_model()
    cfg = model.get_config()
    assert cfg["model_id"] == explain.MODEL_ID
    assert cfg["temperature"] == 0.2 and cfg["max_tokens"] == 250
    monkeypatch.setattr(explain, "_model", None)
