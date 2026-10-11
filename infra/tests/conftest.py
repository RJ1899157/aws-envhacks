import json
import os
import sys
from pathlib import Path

import pytest

INFRA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INFRA / "functions" / "conditions"))
sys.path.insert(0, str(INFRA / "functions" / "explain"))

# No table: cache calls become no-ops unless a test installs a fake one. No real AWS calls.
os.environ.pop("TABLE_NAME", None)
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_REGION", "us-east-1")


class FakeTable:
    """In-memory stand-in for the DynamoDB Table resource (get_item/put_item only)."""

    def __init__(self):
        self.items = {}
        self.puts = 0

    def get_item(self, Key):
        item = self.items.get(Key["pk"])
        return {"Item": item} if item else {}

    def put_item(self, Item):
        self.puts += 1
        self.items[Item["pk"]] = Item


@pytest.fixture
def fake_table():
    return FakeTable()


@pytest.fixture
def explain_body():
    return json.loads((INFRA / "events" / "explain-body.json").read_text(encoding="utf-8"))
