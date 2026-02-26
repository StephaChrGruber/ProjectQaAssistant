from pathlib import Path
import logging

from ..rag.text import chunk_text

IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"}
logger = logging.getLogger(__name__)


def _wanted(path: str, prefixes: list[str] | None) -> bool:
    if not prefixes:
        return True
    return any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes)


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


async def fetch_local_repo_docs(project, config: dict) -> list[dict]:
    repo_path = str(config.get("repo_path") or project.repo_path or "").strip()
    source_mode = "project_repo_path"
    if repo_path.lower().startswith("browser-local://"):
        # Browser-local repos are available only in the client runtime; backend falls back to project folder scan.
        source_mode = "browser_local_fallback"
        repo_path = ""
    if not repo_path:
        # Fallback for empty local path config: scan the current project folder.
        try:
            repo_path = str(Path(__file__).resolve().parents[3])
            source_mode = "backend_project_folder"
        except Exception:
            repo_path = str(Path.cwd())
            source_mode = "cwd_fallback"

    root = Path(repo_path)
    if not root.exists() or not root.is_dir():
        logger.warning(
            "ingest.local.scan_skipped project=%s mode=%s root=%s reason=missing_or_not_dir",
            str(getattr(project, "id", "") or ""),
            source_mode,
            str(root),
        )
        return []

    prefixes = config.get("paths")
    logger.info(
        "ingest.local.scan_start project=%s mode=%s root=%s path_filters=%s",
        str(getattr(project, "id", "") or ""),
        source_mode,
        str(root),
        prefixes if isinstance(prefixes, list) else [],
    )
    docs: list[dict] = []

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        if _is_ignored(rel):
            continue
        if not _wanted(rel, prefixes):
            continue
        if not _is_text_file(rel):
            continue

        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if not raw.strip():
            continue

        docs.append(
            {
                "source": "local",
                "doc_id": rel,
                "title": rel,
                "url": rel,
                "text": raw.strip(),
            }
        )

        if len(docs) >= 3000:
            break

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
