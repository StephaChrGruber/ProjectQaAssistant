# System Architecture Overview

This document provides a high-level overview of the architecture for **Project QA POC**, describing the major components, their interactions, and the data flow between backend, frontend, and supporting services. The system leverages **FastAPI** for the backend, **Next.js** for the frontend, **MongoDB** for persistent storage, and **Ollama** for local LLM inference.

---

## Architecture Diagram

```
+-------------------+       HTTP/REST       +-------------------+       HTTP/REST       +-------------------+
|    Next.js Frontend| <-------------------> |     FastAPI Backend| <-------------------> |      Ollama LLM   |
|   (web/)           |                       |   (backend/)       |                       |   (Docker)        |
+-------------------+                       +-------------------+                       +-------------------+
         |                                           |
         |                                           |
         |                                           v
         |                                   +-------------------+
         |                                   |    MongoDB        |
         |                                   |  (Docker)         |
         |                                   +-------------------+
```

---

## Major Components

### 1. **Frontend (Next.js)**
- **Location:** `web/`
- **Framework:** Next.js (React 19)
- **API Layer:** Uses `/api/*` routes (e.g., `web/src/app/api/admin/custom-tools/route.ts`) as proxies to the backend.
- **Communication:** All business logic and data requests are routed to the FastAPI backend via RESTful HTTP calls. The backend base URL is configurable via `BACKEND_BASE_URL` (defaults to `http://backend:8080` in Docker).
- **Authentication:** Dev/test headers (`X-Dev-User`, `X-Dev-Admin`) are injected for local development.
- **Development:** Run with `npm run dev` (port 3000 by default).

### 2. **Backend (FastAPI)**
- **Location:** `backend/`
- **Framework:** FastAPI (Python 3.12)
- **Key Modules:**
  - **API Routes:** Defined in `backend/app/routes/` (e.g., `tools.py`, `admin.py`, `ingestion.py`)
  - **Models:** Defined in `backend/app/models/` (e.g., `tools.py`, `chat.py`)
  - **Database Access:** Uses `beanie` and `motor` for async MongoDB access.
  - **LLM Integration:** Communicates with Ollama (or optionally OpenAI) via HTTP.
  - **Tooling:** Supports custom and system tools, with endpoints for tool management and execution.
- **Environment Variables:** Configured via Docker Compose and `.env` files (see `docker-compose.yaml`).
- **Development:** Run with `uvicorn` (see `backend/requirements.txt`).

### 3. **MongoDB**
- **Location:** Docker service `mongo`
- **Purpose:** Stores all persistent data, including projects, users, chat history, tool definitions, and ingestion runs.
- **Connection:** Backend connects via `MONGODB_URI` (typically `mongodb://mongo:27017` in Docker).
- **Initialization:** Optionally seeded via `./mongo-init` directory.

### 4. **Ollama (LLM Inference)**
- **Location:** Docker service `ollama`
- **Purpose:** Provides local LLM inference via HTTP API (`http://ollama:11434`).
- **Usage:** Backend sends LLM requests (e.g., for chat, tool execution) to Ollama.
- **Model Management:** The `ollama-pull` service ensures the required model is downloaded at startup.
- **Configuration:** Model and base URL are set via environment variables (`OLLAMA_MODEL`, `LLM_BASE_URL`).

---

## Data Flow

1. **User Interaction:**
   - Users interact with the web UI (Next.js).
   - UI actions (e.g., chat, tool management) trigger API calls to the backend.

2. **Frontend-to-Backend Communication:**
   - All API requests from the frontend are routed through `/api/*` endpoints, which proxy to the FastAPI backend.
   - Example: `web/src/app/api/admin/custom-tools/route.ts` forwards requests to `/admin/custom-tools` on the backend.

3. **Backend Processing:**
   - The backend handles authentication, business logic, and data validation.
   - For persistent data, it interacts with MongoDB using Beanie/Motor.
   - For LLM tasks (e.g., chat, code generation), it sends requests to Ollama via HTTP.

4. **LLM Integration:**
   - The backend communicates with Ollama using the REST API (`/v1` endpoints).
   - Ollama runs as a separate Docker service and serves models specified by `OLLAMA_MODEL`.

5. **Data Storage:**
   - All project, user, chat, and tool data is stored in MongoDB.
   - Ingestion and connector data are also persisted here.

---

## Component Interactions

### Frontend ↔ Backend
- **API Proxying:** All business logic is centralized in the backend. The frontend acts as a thin client, proxying requests and rendering responses.
- **Endpoints:** Example endpoints include `/admin/custom-tools`, `/admin/system-tools`, `/tools/catalog`, etc.

### Backend ↔ MongoDB
- **ORM:** Uses Beanie (built on Motor) for async document modeling and queries.
- **Collections:** Projects, users, chat logs, tools, ingestion runs, etc.

### Backend ↔ Ollama
- **LLM Requests:** The backend sends prompt and tool execution requests to Ollama.
- **Model Selection:** Model and endpoint are configurable via environment variables.

---

## Setup & Operational Details

- **Docker Compose:** All services (frontend, backend, MongoDB, Ollama) are orchestrated via `docker-compose.yaml`.
  - **Ports:**
    - Frontend: 3000
    - Backend: 8080
    - MongoDB: 27017
    - Ollama: 11434
  - **Volumes:** Data is persisted using Docker volumes (e.g., `mongo_data`, `ollama_data`, `chroma_data`).

- **Environment Variables:** Critical
