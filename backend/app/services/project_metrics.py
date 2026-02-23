from __future__ import annotations

from typing import Any


def percentile_int(values: list[int], p: float) -> int:
    if not values:
        return 0
    sorted_vals = sorted(values)
    idx = int(round((max(0.0, min(p, 1.0))) * (len(sorted_vals) - 1)))
    return int(sorted_vals[idx])


def summarize_tool_event_rows(rows: list[dict[str, Any]]) -> tuple[int, int, list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    total_calls = 0
    total_errors = 0
    for row in rows:
        calls = int(row.get("calls") or 0)
        errors = int(row.get("errors") or 0)
        total_calls += calls
        total_errors += errors
        items.append(
            {
                "tool": str(row.get("_id") or ""),
                "calls": calls,
                "ok": int(row.get("ok") or 0),
                "errors": errors,
                "cached_hits": int(row.get("cached_hits") or 0),
                "avg_duration_ms": int(round(float(row.get("avg_duration_ms") or 0))),
            }
        )
    return total_calls, total_errors, items


def build_qa_metrics_payload(
    *,
    project_id: str,
    hours: int,
    branch: str | None,
    tool_rows: list[dict[str, Any]],
    chats: list[dict[str, Any]],
) -> dict[str, Any]:
    per_tool: dict[str, dict[str, Any]] = {}
    all_durations: list[int] = []
    timeout_count = 0
    for row in tool_rows:
        tool = str(row.get("tool") or "unknown")
        ok = bool(row.get("ok"))
        duration_ms = int(row.get("duration_ms") or 0)
        err_code = str(row.get("error_code") or "").strip().lower()
        is_timeout = err_code == "timeout"
        if is_timeout:
            timeout_count += 1
        all_durations.append(duration_ms)
        slot = per_tool.setdefault(
            tool,
            {"tool": tool, "calls": 0, "errors": 0, "timeouts": 0, "durations": []},
        )
        slot["calls"] += 1
        if not ok:
            slot["errors"] += 1
        if is_timeout:
            slot["timeouts"] += 1
        slot["durations"].append(duration_ms)

    tool_summary: list[dict[str, Any]] = []
    for slot in per_tool.values():
        durations = [int(v) for v in (slot.get("durations") or [])]
        calls = int(slot.get("calls") or 0)
        tool_summary.append(
            {
                "tool": slot.get("tool"),
                "calls": calls,
                "errors": int(slot.get("errors") or 0),
                "timeouts": int(slot.get("timeouts") or 0),
                "avg_duration_ms": int(round(sum(durations) / calls)) if calls else 0,
                "p95_duration_ms": percentile_int(durations, 0.95),
            }
        )
    tool_summary.sort(key=lambda x: int(x.get("calls") or 0), reverse=True)

    assistant_msgs = 0
    with_sources = 0
    grounded_failures = 0
    tool_calls_sum = 0
    for chat in chats:
        for msg in (chat.get("messages") or []):
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role") or "") != "assistant":
                continue
            assistant_msgs += 1
            meta = msg.get("meta") if isinstance(msg.get("meta"), dict) else {}
            sources = meta.get("sources") if isinstance(meta.get("sources"), list) else []
            if sources:
                with_sources += 1
            if meta.get("grounded") is False:
                grounded_failures += 1
            tool_summary_meta = meta.get("tool_summary") if isinstance(meta.get("tool_summary"), dict) else {}
            tool_calls_sum += int(tool_summary_meta.get("calls") or 0)

    source_coverage = round((with_sources / assistant_msgs) * 100, 2) if assistant_msgs else 0.0
    avg_tool_calls_per_answer = round(tool_calls_sum / assistant_msgs, 2) if assistant_msgs else 0.0

    return {
        "project_id": project_id,
        "hours": hours,
        "branch": branch,
        "tool_calls": len(tool_rows),
        "tool_errors": sum(1 for r in tool_rows if not bool(r.get("ok"))),
        "tool_timeouts": timeout_count,
        "tool_latency_avg_ms": int(round(sum(all_durations) / len(all_durations))) if all_durations else 0,
        "tool_latency_p95_ms": percentile_int(all_durations, 0.95),
        "assistant_messages": assistant_msgs,
        "answers_with_sources": with_sources,
        "source_coverage_pct": source_coverage,
        "grounded_failures": grounded_failures,
        "avg_tool_calls_per_answer": avg_tool_calls_per_answer,
        "tool_summary": tool_summary,
    }

