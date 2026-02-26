import os
from pathlib import Path
import logging

from ..rag.text import chunk_text

IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"}
logger = logging.getLogger(__name__)


def _wanted(path: str, prefixes: list[str] | None) -> bool:
    if not prefixes:
        return True
    return any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes)


def _normalize_prefixes(value) -> list[str] | None:
    if value is None:
        return None
    rows: list[str] = []
    if isinstance(value, str):
        rows = [part.strip() for part in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        rows = [str(part).strip() for part in value]
    out: list[str] = []
    for row in rows:
        if not row:
            continue
        normalized = row.replace("\\", "/").strip().strip("/")
        if normalized:
            out.append(normalized)
    return out or None


def _is_ignored(path: str) -> bool:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return any(p in IGNORE_PARTS for p in parts)


def _is_text_file(path: str) -> bool:
    lower = path.lower()
    return any(
        lower.endswith(ext)
        for ext in [
            ".md",
            ".txt",
            ".rst",
            ".py",
            ".js",
            ".ts",
            ".tsx",
            ".json",
            ".yml",
            ".yaml",
            ".java",
            ".kt",
            ".cs",
            ".sql",
            ".html",
            ".css",
            ".go",
            ".rs",
            ".toml",
            ".ini",
            ".cfg",
            ".env",
            ".sh",
        ]
    )


def _default_backend_repo_root() -> Path:
    candidates: list[Path] = []
    env_root = str(os.getenv("PQA_LOCAL_REPO_FALLBACK_ROOT") or "").strip()
    if env_root:
        candidates.append(Path(env_root))
    try:
        # In container layout this resolves to /app (repo root), not filesystem root.
        candidates.append(Path(__file__).resolve().parents[2])
    except Exception:
        pass
    candidates.append(Path.cwd())

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            resolved = candidate
        if resolved.exists() and resolved.is_dir() and str(resolved) != "/":
            return resolved
    return Path.cwd()


async def fetch_local_repo_docs(project, config: dict) -> list[dict]:
    repo_path = str(config.get("repo_path") or project.repo_path or "").strip()
    source_mode = "project_repo_path"
    if repo_path.lower().startswith("browser-local://"):
        # Browser-local repos are available only in the client runtime; backend falls back to project folder scan.
        source_mode = "browser_local_fallback"
        repo_path = ""
    if not repo_path:
        # Fallback for empty local path config: scan backend project folder (typically /app).
        repo_path = str(_default_backend_repo_root())
        source_mode = "backend_project_folder"

    root = Path(repo_path)
    if not root.exists() or not root.is_dir():
        fallback = _default_backend_repo_root()
        fallback_mode = "configured_path_missing_fallback"
        if fallback != root and fallback.exists() and fallback.is_dir():
            logger.warning(
                "ingest.local.scan_root_fallback project=%s mode=%s bad_root=%s fallback_root=%s",
                str(getattr(project, "id", "") or ""),
                source_mode,
                str(root),
                str(fallback),
            )
            root = fallback
            source_mode = fallback_mode
    if not root.exists() or not root.is_dir():
        logger.warning(
            "ingest.local.scan_skipped project=%s mode=%s root=%s reason=missing_or_not_dir_after_fallback",
            str(getattr(project, "id", "") or ""),
            source_mode,
            str(root),
        )
        return []

    prefixes = _normalize_prefixes(config.get("paths"))
    logger.info(
        "ingest.local.scan_start project=%s mode=%s root=%s path_filters=%s",
        str(getattr(project, "id", "") or ""),
        source_mode,
        str(root),
        prefixes or [],
    )
    docs: list[dict] = []
    max_docs = 3000
    root_str = str(root)

    def scan(scan_prefixes: list[str] | None) -> list[dict]:
        out: list[dict] = []
        for dirpath, dirnames, filenames in os.walk(root_str, topdown=True, followlinks=False):
            # Prune ignored folders early to keep traversal fast and safe.
            dirnames[:] = [d for d in dirnames if d not in IGNORE_PARTS]
            for fname in filenames:
                p = Path(dirpath) / fname
                try:
                    rel = str(p.relative_to(root)).replace("\\", "/")
                except Exception:
                    continue
                if _is_ignored(rel):
                    continue
                if not _wanted(rel, scan_prefixes):
                    continue
                if not _is_text_file(rel):
                    continue

                try:
                    raw = p.read_text(encoding="utf-8", errors="replace")
                except (OSError, PermissionError):
                    continue
                if not raw.strip():
                    continue

                out.append(
                    {
                        "source": "local",
                        "doc_id": rel,
                        "title": rel,
                        "url": rel,
                        "text": raw.strip(),
                    }
                )

                if len(out) >= max_docs:
                    break
            if len(out) >= max_docs:
                break
        return out

    docs = scan(prefixes)
    if not docs and prefixes:
        logger.warning(
            "ingest.local.scan_empty_with_filters project=%s root=%s filters=%s retry=without_filters",
            str(getattr(project, "id", "") or ""),
            str(root),
            prefixes,
        )
        docs = scan(None)

    logger.info(
        "ingest.local.scan_done project=%s mode=%s root=%s docs=%s",
        str(getattr(project, "id", "") or ""),
        source_mode,
        str(root),
        len(docs),
    )
    return docs


def to_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for d in docs:
        parts = chunk_text(d["text"])
        for idx, part in enumerate(parts):
            chunks.append(
                {
                    "id": f"local:{d['doc_id']}#{idx}",
                    "text": part,
                    "metadata": {
                        "source": d["source"],
                        "title": d["title"],
                        "url": d["url"],
                        "doc_id": d["doc_id"],
                        "chunk": idx,
                    },
                }
            )
    return chunks
