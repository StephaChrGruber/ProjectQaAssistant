from __future__ import annotations

from typing import Iterable, Sequence

from pymongo.errors import OperationFailure


IndexKey = Sequence[tuple[str, int]]


def _normalize_keys(keys: Iterable[tuple[str, int]] | None) -> tuple[tuple[str, int], ...]:
    out: list[tuple[str, int]] = []
    for key, direction in list(keys or []):
        out.append((str(key), int(direction)))
    return tuple(out)


async def ensure_index(
    collection,
    keys: IndexKey,
    *,
    unique: bool = False,
    name: str | None = None,
) -> str:
    wanted_keys = _normalize_keys(keys)
    existing = await collection.index_information()
    for index_name, spec in existing.items():
        if _normalize_keys(spec.get("key")) != wanted_keys:
            continue
        if unique and not bool(spec.get("unique", False)):
            continue
        return str(index_name)

    kwargs: dict[str, object] = {}
    if unique:
        kwargs["unique"] = True
    if name:
        kwargs["name"] = name

    try:
        return str(await collection.create_index(list(wanted_keys), **kwargs))
    except OperationFailure as exc:
        # Code 85 = IndexOptionsConflict, often triggered by same key pattern with different index name.
        if int(getattr(exc, "code", 0) or 0) != 85:
            raise
        existing = await collection.index_information()
        for index_name, spec in existing.items():
            if _normalize_keys(spec.get("key")) != wanted_keys:
                continue
            if unique and not bool(spec.get("unique", False)):
                continue
            return str(index_name)
        raise
