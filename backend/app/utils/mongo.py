from __future__ import annotations
from typing import Any, Dict, List
from bson import ObjectId

def to_jsonable(doc: Any) -> Any:
    """
    Recursively converts Mongo types (ObjectId) into JSON-serializable values.
    """
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, dict):
        return {k: to_jsonable(v) for k, v in doc.items()}
    if isinstance(doc, list):
        return [to_jsonable(x) for x in doc]
    return doc

def oid(id_str: str) -> ObjectId:
    return ObjectId(id_str)
