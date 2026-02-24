# Backend Architecture

This document details the backend structure of **Project QA POC**, focusing on its key modules, API design, and extensibility points. It is intended for developers who need to understand, extend, or operate the backend.

---

## Overview

The backend is implemented in Python using **FastAPI** and is containerized for deployment via Docker Compose. It provides RESTful APIs for project QA, chat, ingestion, tool execution, and administration. MongoDB is used for persistent storage, and ChromaDB is used for vector search and semantic retrieval.

**Key directories and files:**
- `backend/app/routes/`: FastAPI route modules (API endpoints)
- `backend/app/models/`: Pydantic models for request/response validation and data structures
- `backend/app/services/`: Business logic and integrations
- `backend/app/rag/`: Retrieval-Augmented Generation (RAG) logic
- `backend/app/utils/`: Utility functions (DB, repo, etc.)
- `backend/app/db.py`: Database connection helpers
- `backend/requirements.txt`: Python dependencies

---

## Key Modules

### 1. **Routes (API Endpoints)**

All API endpoints are organized as FastAPI routers under `backend/app/routes/`. Each file typically corresponds to a functional area:

- **`routes/tools.py`**: Tool catalog, repo grep, file open, keyword search, and project metadata endpoints.
- **`routes/ingestion.py`**: Project ingestion endpoints (triggering, webhook, incremental, etc.).
- **`routes/chat.py`** and **`routes/chats.py`**: Chat session management, message handling, chat memory, and tool policy endpoints.
- **`routes/admin.py`**: Admin endpoints for project, connector, and LLM profile management.

**Example: Tool Catalog Endpoint**
```python
@router.get("/tools/catalog")
async def tools_catalog(project_id: Optional[str] = None):
    if project_id:
        runtime = await build_runtime_for_project(project_id)
    else:
        runtime = build_default_tool_runtime()
    return {"tools": runtime.catalog()}
```

### 2. **Models**

Pydantic models in `backend/app/models/` define the structure of API requests and responses, as well as internal data representations.

- **`models/tools.py`**: Defines requests/responses for tool execution (e.g., `RepoGrepRequest`, `OpenFileRequest`).
- **`models/chat.py`**: Defines chat message, chat document, and chat response structures.
- **`models/base_mongo_models.py`**: MongoDB document models for projects, memberships, connectors, etc.

**Example: Chat Message Model**
```python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    ts: datetime = Field(default_factory=datetime.utcnow)
    meta: dict | None = None
```

### 3. **Services**

Business logic and integrations are encapsulated in the `backend/app/services/` directory.

- **`services/custom_tools.py`**: Handles dynamic loading and execution of custom tools per project.
- **`services/chat_store.py`**: Manages chat persistence and retrieval.
- **`services/feature_flags.py`**: Feature flag management per project.
- **`services/llm_profiles.py`**: LLM configuration and profile resolution.

### 4. **RAG (Retrieval-Augmented Generation) Logic**

The `backend/app/rag/` directory contains logic for:
- Ingesting project data into ChromaDB (`rag/ingest.py`)
- Tool runtime and orchestration (`rag/tool_runtime.py`)
- Agent-based QA logic (`rag/agent2.py`)

### 5. **Utilities**

- **`utils/projects.py`**: Project metadata helpers.
- **`utils/repo_tools.py`**: Repo grep and file access utilities.
- **`utils/mongo.py`**: MongoDB ID and serialization helpers.

---

## API Design

- **RESTful endpoints** are grouped by resource and function.
- **Authentication** is handled via dependency injection (`Depends(current_user)`), with support for project and global admin roles.
- **Request/response validation** is enforced using Pydantic models.
- **Async**: All endpoints are asynchronous for scalability.
- **Error handling**: Uses FastAPI's HTTPException for error responses.

**Example: Ingestion Endpoint**
```python
@router.post("/projects/{project_id}/ingest")
async def ingest_project(project_id: str, req: IncrementalIngestReq, user=Depends(current_user)):
    await _require_project_admin(project_id, user)
    # ... ingestion logic ...
```

---

## Extensibility Points

### 1. **Custom Tools**

- **Definition**: Custom tools are Python functions or scripts that can be registered per project.
- **Runtime**: The tool runtime is built dynamically for each project (`build_runtime_for_project` in `services/custom_tools.py`).
- **API**: Tools are exposed via `/tools/catalog` and can be invoked through chat or directly via API.
- **Admin APIs**: Tool management endpoints are available under `/admin/custom-tools` (see frontend routes for usage).

### 2. **Ingestion**

- **Connectors**: Supports multiple connector types (e.g., GitHub, Jira, Confluence, local).
- **Incremental and webhook-based ingestion**: Endpoints in `routes/ingestion.py` allow for flexible data ingestion strategies.
- **Ingestion runs** are tracked in the `ingestion_runs` MongoDB collection.

### 3. **Chat and QA Logic**

- **Chat sessions**: Managed via `routes/chat.py` and `routes/chats.py`, with persistent storage in MongoDB.
- **Memory and context**: Each chat maintains a memory summary and pending user questions.
- **Tool invocation**: Chats can invoke tools as part of the QA workflow, with tool policies and approvals configurable per chat.

### 4. **LLM Integration**

- **LLM configuration**: Supports multiple LLM providers (Ollama, OpenAI) via environment variables and project-level profiles.
- **Runtime selection**: LLMs are resolved per project and
