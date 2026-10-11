"""POST /explain: a short plain-language explanation of one ranked action, from a Strands Agent on Bedrock.

Flow: validate body -> DynamoDB cache -> agent -> grounding check (retry once, stricter) -> cache.
Ungrounded answers are returned as { "text": null, "reason": "ungrounded" } and never cached.
"""

import json
import os
import time

from botocore.config import Config as BotocoreConfig
from strands import Agent, ModelRetryStrategy
from strands.models import BedrockModel

import grounding
import validation

TABLE_NAME = os.environ.get("TABLE_NAME", "")
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "604800"))
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-lite-v1:0")
TEMPERATURE = float(os.environ.get("BEDROCK_TEMPERATURE", "0.2"))
MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "250"))
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(validation.MAX_BODY_BYTES)))

SYSTEM_PROMPT = """You explain one suggested change to a home's indoor air quality.
Your reader is a non-technical Indian household.

Rules:
- Write 2 to 3 short, plain sentences explaining why this action improves the indoor air.
- Use ONLY the facts and numbers given in the input. Never invent numbers, health claims, product names, brands or costs.
- Mention the main change in PM2.5 from before to after, using the given numbers (µg/m³).
- If "verified" is "disagrees", add one short caution that the detailed 3D check did not confirm this result.
- Plain text only: no markdown, no lists, no headings."""

STRICT_REMINDER = """Your previous answer used numbers that are not in the input: {bad}.
Rewrite it. Use only numbers that appear in the input exactly (you may round them to 0 or 1 decimals),
or the percentage change given. If unsure, leave a number out."""

_table = None
_model = None


class ModelError(Exception):
    pass


def _get_table():
    global _table
    if _table is None and TABLE_NAME:
        import boto3

        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def _get_model():
    """One BedrockModel (and boto client) per container; agents are created per call so no history leaks."""
    global _model
    if _model is None:
        _model = BedrockModel(
            model_id=MODEL_ID,
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
            # Two attempts at most must fit inside the 30 s Lambda timeout
            boto_client_config=BotocoreConfig(connect_timeout=3, read_timeout=10, retries={"max_attempts": 1, "mode": "standard"}),
        )
    return _model


def user_prompt(payload):
    return "Explain this suggested action. Input:\n" + json.dumps(payload, ensure_ascii=False, indent=1)


def call_model(system_prompt, prompt):
    """Runs a fresh Strands Agent and returns its text; raises ModelError on any Bedrock/SDK failure."""
    try:
        agent = Agent(
            model=_get_model(),
            system_prompt=system_prompt,
            callback_handler=None,
            retry_strategy=ModelRetryStrategy(max_attempts=2, initial_delay=1, max_delay=2),
        )
        return str(agent(prompt)).strip()
    except Exception as e:
        raise ModelError(type(e).__name__) from e


def generate(payload, model_call=call_model):
    """Grounded text, or None if both attempts contain numbers not derivable from the input."""
    prompt = user_prompt(payload)
    text = model_call(SYSTEM_PROMPT, prompt)
    bad = grounding.ungrounded_numbers(text, payload)
    if not bad:
        return text
    print(json.dumps({"route": "explain", "warn": "ungrounded, retrying", "numbers": bad[:5]}))
    strict = SYSTEM_PROMPT + "\n\n" + STRICT_REMINDER.format(bad=", ".join(f"{n:g}" for n in bad[:5]))
    text = model_call(strict, prompt)
    return text if grounding.is_grounded(text, payload) else None


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def error(status, reason):
    return response(status, {"error": True, "reason": reason})


def cache_get(key, now=None):
    table = _get_table()
    if table is None:
        return None
    try:
        item = table.get_item(Key={"pk": key}).get("Item")
    except Exception as e:
        print(json.dumps({"route": "explain", "warn": "cache read failed", "detail": type(e).__name__}))
        return None
    if not item or int(item.get("expiresAt", 0)) <= int(now or time.time()):
        return None
    return item.get("text")


def cache_put(key, text, now=None):
    table = _get_table()
    if table is None:
        return
    try:
        table.put_item(Item={"pk": key, "text": text, "model": MODEL_ID, "expiresAt": int(now or time.time()) + CACHE_TTL_SECONDS})
    except Exception as e:
        print(json.dumps({"route": "explain", "warn": "cache write failed", "detail": type(e).__name__}))


def handler(event, context=None, model_call=call_model):
    t0 = time.perf_counter()
    status, cache, outcome = 200, "miss", "ok"
    try:
        try:
            payload = validation.parse(validation.read_body(event, MAX_BODY_BYTES))
        except validation.InvalidInput as e:
            status, outcome = 400, "invalid"
            return error(400, str(e))

        key = validation.cache_key(payload)
        cached = cache_get(key)
        if cached:
            cache = "hit"
            return response(200, {"text": cached, "model": MODEL_ID, "cached": True})

        try:
            text = generate(payload, model_call)
        except ModelError as e:
            status, outcome = 502, "model_error"
            return error(502, f"model call failed: {e}")
        if text is None:
            outcome = "ungrounded"
            return response(200, {"text": None, "reason": "ungrounded"})
        cache_put(key, text)
        return response(200, {"text": text, "model": MODEL_ID, "cached": False})
    finally:
        print(json.dumps({"route": "explain", "status": status, "cache": cache, "outcome": outcome, "ms": round((time.perf_counter() - t0) * 1000)}))
