export const LOCAL_REPO_PREFIX = "browser-local://"
export const SESSION_STORAGE_PREFIX = "projectqa.localRepo."
export const LOCAL_STORAGE_PREFIX = "projectqa.localRepo.persist."

export const IDB_NAME = "projectqa-local-repo"
export const IDB_VERSION = 1
export const IDB_STORE_SNAPSHOTS = "snapshots"
export const IDB_STORE_HANDLES = "handles"

export const MAX_FILES = 1200
export const MAX_FILE_BYTES = 350_000
export const MAX_TOTAL_CHARS = 2_200_000

export const MAX_HITS = 18
export const MAX_HITS_PER_TERM = 6

export const DOC_CONTEXT_MAX_FILES = 50
export const DOC_CONTEXT_MAX_CHARS = 120_000
export const DOC_CONTEXT_MAX_FILE_CHARS = 3_500

export const SKIP_DIR_PARTS = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
])

export const IMPORTANT_NAMES = new Set([
    "readme.md",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "poetry.lock",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "cargo.toml",
    "next.config.js",
    "next.config.ts",
    "tsconfig.json",
])

export const TEXT_FILE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".cs",
    ".swift",
    ".scala",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".txt",
    ".md",
    ".adoc",
    ".rst",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".dockerfile",
    ".gitignore",
    ".gitattributes",
    ".properties",
    ".proto",
    ".vue",
    ".svelte",
])

export const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "that",
    "with",
    "this",
    "from",
    "what",
    "when",
    "where",
    "which",
    "into",
    "about",
    "please",
    "show",
    "find",
    "have",
    "will",
    "would",
    "could",
    "should",
    "does",
    "dont",
    "can't",
    "cannot",
    "repo",
    "project",
    "code",
    "files",
])
