# Project QA POC

Welcome to **Project QA POC** — a proof-of-concept platform for question answering, code search, and knowledge management over software projects. This documentation serves as the entry point for developers, contributors, and operators.

---

## Overview

Project QA POC enables teams to ingest, index, and query their codebases and documentation using advanced search and LLM-powered tools. It supports extensibility via custom tools and connectors, and provides both a backend API (FastAPI) and a modern frontend (Next.js/React).

---

## Main Features

- **Semantic & Keyword Search:**  
  Search code and documentation using both semantic (vector-based) and keyword (regex) queries.
- **LLM Integration:**  
  Connects to local or remote LLMs (e.g., via Ollama or OpenAI) for question answering and summarization.
- **Custom Tools:**  
  Define and manage custom tools (backend Python or local TypeScript) for project-specific automation and analysis.
- **Connector Framework:**  
  Integrate with external sources (e.g., GitHub, Jira, Confluence) for ingestion and enrichment.
- **Role-Based Access:**  
  User/group/project management with admin/member/viewer roles.
- **Ingestion Pipeline:**  
  Incremental and webhook-based ingestion for code and external data.
- **Modern Web UI:**  
  Built with Next.js, React, and MUI for a responsive, developer-friendly experience.
- **Audit & Versioning:**  
  Track tool versions, audit runs, and publish/test custom tools.

---

## High-Level Goals

- **Accelerate developer onboarding and productivity** by making project knowledge easily discoverable.
- **Enable rapid prototyping of AI-powered developer tools** with a flexible, extensible backend.
- **Support secure, role-based collaboration** across teams and projects.
- **Integrate with real-world developer workflows** (code, issues, docs, chat).

---

## Architecture

- **Backend:**  
  - FastAPI app (`backend/app/`)
  - MongoDB (data storage)
  - ChromaDB (vector search)
  - Ollama or OpenAI (LLM inference)
  - Key modules:  
    - `models/` (e.g., `tools.py`, `chat.py`, `base_mongo_models.py`)
    - `routes/` (e.g., `tools.py`, `ingestion.py`)
    - `services/`, `rag/`, `utils/`
- **Frontend:**  
  - Next.js app (`web/`)
  - TypeScript, React, MUI, Monaco Editor
  - API routes (e.g., `web/src/app/api/admin/custom-tools/`)
  - Uses OpenAPI-generated types for backend integration

- **Deployment:**  
  - Docker Compose (`docker-compose.yaml`) for local development and testing
  - Services: `mongo`, `ollama`, `backend`, `frontend`
  - Environment variables for configuration (see `.env` and `docker-compose.yaml`)

---

## Getting Started

1. **Clone the repository** and review the [Getting Started guide](setup/getting-started.md).
2. **Start services** using Docker Compose:
   ```sh
   docker-compose up --build
   ```
3. **Access the web UI** at [http://localhost:3000](http://localhost:3000).
4. **Configure your project** and begin ingestion via the web UI or API.
5. **Explore and extend** using custom tools and connectors.

For detailed setup, see:
- [Setup: Getting Started](setup/getting-started.md)
- [Setup: Docker Compose](setup/docker-compose.md)
- [Setup: Development](setup/development.md)

---

## Extending Project QA POC

- **Custom Tools:**  
  Add Python or TypeScript tools for project-specific automation. See [Custom Tools](extensibility/custom-tools.md).
- **Connectors:**  
  Integrate with external systems (e.g., GitHub, Jira). See [Connectors](extensibility/connectors.md).

---

## Documentation Structure

- **Architecture**
  - [Overview](architecture/overview.md)
  - [Backend](architecture/backend.md)
  - [Frontend](architecture/frontend.md)
  - [Data Models](architecture/data-models.md)
- **Setup**
  - [Getting Started](setup/getting-started.md)
  - [Docker Compose](setup/docker-compose.md)
  - [Development](setup/development.md)
- **Extensibility**
  - [Custom Tools](extensibility/custom-tools.md)
  - [Connectors](extensibility/connectors.md)

---

## Key Modules & Files

- **Backend**
  - `backend/app/models/tools.py` — Tool and search request/response models
  - `backend/app/routes/tools.py` — Tool catalog, project metadata, search endpoints
  - `backend/app/models/chat.py` — Chat and message models
  - `backend/app/models/base_mongo_models.py` — User, group, project, and connector models
  - `backend/app/routes/ingestion.py` — Ingestion endpoints and logic
  - `backend/requirements.txt`, `pyproject.toml` — Dependencies and linting/type-checking config

- **Frontend**
  - `web/src/app/api/admin/custom-tools/` — API routes for custom tool management
  - `web/package.json`, `tsconfig.json` — Frontend dependencies and TypeScript config

- **Deployment**
  - `docker-compose.yaml` — Service orchestration for local development

---

## Contributing

- Follow code style and linting rules (`ruff`, `mypy`, `eslint`, `prettier`).
- Write and run tests (`pytest` for backend, `vitest` for frontend).
- See [Development Setup](setup/development.md) for details.

---

## Support & Feedback

For questions, issues, or feature requests, please open an issue or contact the maintainers.

---

**Start exploring the documentation using the links above!**
