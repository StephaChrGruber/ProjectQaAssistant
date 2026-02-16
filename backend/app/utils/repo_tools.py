from __future__ import annotations
import os
import subprocess
from typing import List, Tuple, Optional
from fastapi import HTTPException


def _safe_join(root: str, rel_path: str) -> str:
    rel_path = rel_path.lstrip("/").replace("\\", "/")
    if ".." in rel_path.split("/"):
        raise HTTPException(status_code=400, detail="Invalid path")
    full = os.path.abspath(os.path.join(root, rel_path))
    root_abs = os.path.abspath(root)
    if not full.startswith(root_abs + os.sep) and full != root_abs:
        raise HTTPException(status_code=400, detail="Invalid path")
    return full


def _run(cmd: List[str], cwd: str, timeout: int = 20) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Command timed out")


def repo_grep_rg(
        repo_root: str,
        pattern: str,
        glob: Optional[str],
        case_sensitive: bool,
        regex: bool,
        max_results: int,
        context_lines: int,
) -> List[Tuple[str, int, int, str, List[str], List[str]]]:
    # Use ripgrep with line/column output. (We parse plain text output to avoid JSON mode complexity.)
    cmd = ["rg", "--line-number", "--column", "--max-count", str(max_results)]
    cmd += ["--context", str(context_lines)]
    cmd += ["--no-heading", "--color", "never"]

    if not case_sensitive:
        cmd += ["-i"]
    if not regex:
        cmd += ["-F"]
    if glob:
        cmd += ["-g", glob]

    cmd += [pattern, "."]

    r = _run(cmd, cwd=repo_root, timeout=25)
    if r.returncode not in (0, 1):  # 0=matches, 1=no matches
        raise HTTPException(status_code=500, detail=f"rg failed: {r.stderr.strip()}")

    # Parse rg output:
    # match: path:line:col:text
    # context: path-line-col-text (rg context uses '-' separators); and '--' group separators may appear
    matches = []
    by_key = {}  # (path,line,col) -> build context
    current_key = None

    for raw in r.stdout.splitlines():
        if raw.strip() == "--":
            current_key = None
            continue

        # Match line has ':' separators at least 3 times
        if raw.count(":") >= 3 and ":-" not in raw:
            # Best effort split: path can contain ':' on Windows; but in container it's usually linux.
            path, line, col, text = raw.split(":", 3)
            key = (path, int(line), int(col))
            by_key[key] = {"snippet": text, "before": [], "after": []}
            matches.append(key)
            current_key = key
            continue

        # Context line usually: path-line-col-text
        if current_key and raw.count("-") >= 3:
            parts = raw.split("-", 3)
            if len(parts) == 4:
                cpath, cline, ccol, ctext = parts
                if cpath == current_key[0]:
                    # decide before/after based on line number
                    ln = int(cline)
                    if ln < current_key[1]:
                        by_key[current_key]["before"].append(ctext)
                    elif ln > current_key[1]:
                        by_key[current_key]["after"].append(ctext)

    out = []
    for key in matches:
        ctx = by_key.get(key) or {"snippet": "", "before": [], "after": []}
        out.append((key[0], key[1], key[2], ctx["snippet"], ctx["before"], ctx["after"]))
    return out


def repo_open_file(
        repo_root: str,
        rel_path: str,
        ref: Optional[str],
        start_line: Optional[int],
        end_line: Optional[int],
        max_chars: int,
) -> Tuple[int, int, str]:
    if start_line is None:
        start_line = 1

    # Fetch file content either from worktree or git ref
    if ref:
        # git show ref:path
        git_path = rel_path.lstrip("/").replace("\\", "/")
        cmd = ["git", "show", f"{ref}:{git_path}"]
        r = _run(cmd, cwd=repo_root, timeout=20)
        if r.returncode != 0:
            raise HTTPException(status_code=404, detail=f"File not found at ref: {ref}")
        content = r.stdout
    else:
        full = _safe_join(repo_root, rel_path)
        if not os.path.exists(full) or not os.path.isfile(full):
            raise HTTPException(status_code=404, detail="File not found")
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_chars + 1)

    if len(content) > max_chars:
        content = content[:max_chars] + "\n\n…(truncated)…\n"

    lines = content.splitlines()
    total = len(lines)
    if end_line is None or end_line > total:
        end_line = total
    if start_line < 1:
        start_line = 1
    if end_line < start_line:
        end_line = start_line

    sliced = "\n".join(lines[start_line - 1 : end_line])
    return start_line, end_line, sliced
