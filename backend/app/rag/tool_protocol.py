import json
import re
from typing import Any, Optional

_TOOL_RE = re.compile(r"```tool\s*([\s\S]*?)```", re.MULTILINE)

def extract_tool_call(text: str) -> Optional[dict[str, Any]]:
    m = _TOOL_RE.search(text or "")
    if not m:
        return None
    payload = (m.group(1) or "").strip()
    return json.loads(payload)
