# Getting Started

Welcome to the **Project QA POC**! This guide will walk you through setting up the project locally, including all prerequisites, environment variables, and initial setup steps. By the end, you’ll have the backend, frontend, and supporting services running on your machine.

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Docker** and **Docker Compose** (for running services)
- **Node.js** (v18+ recommended) and **npm** or **yarn** (for frontend development)
- **Python 3.12** (for backend development)
- **Git** (to clone the repository)

---

## 1. Clone the Repository

```bash
git clone <your-repo-url>
cd <your-repo-directory>
```

---

## 2. Environment Variables

The project uses environment variables for configuration. Create a `.env` file in the root directory (or copy from `.env.example` if available).

### Example `.env` values:

```env
# MongoDB
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB=project_qa

# Authentication
AUTH_MODE=dev

# ChromaDB
CHROMA_ROOT=/data/chroma_projects

# Web Origin
WEB_ORIGIN=http://localhost:3000

# LLM (Ollama or OpenAI)
LLM_BASE_URL=http://ollama:11434
LLM_MODEL=llama2
LLM_API_KEY=
OPENAI_API_KEY=

# Telemetry
ANONYMIZED_TELEMETRY=False

# Path Picker
PATH_PICKER_ROOTS=/host/repos

# Ollama Model (used by ollama-pull)
OLLAMA_MODEL=llama2
```

**Note:**  
- Adjust `LLM_MODEL` and `OLLAMA_MODEL` to the model you want to use (e.g., `llama2`, `mistral`, etc.).
- `OPENAI_API_KEY` is only needed if using OpenAI models.

---

## 3. Start All Services with Docker Compose

The project uses `docker-compose.yaml` to orchestrate all required services:

- **MongoDB** (database)
- **Ollama** (local LLM server)
- **ChromaDB** (vector database, mounted as a volume)
- **Backend** (FastAPI app, built from `./backend`)
- **Frontend** (Next.js app, built from `./web`)

To start everything:

```bash
docker compose up --build
```

This will:

- Build the backend from `./backend`
- Start the frontend from `./web`
- Pull and run the Ollama model specified in your `.env`
- Expose the following ports:
  - MongoDB: `27017`
  - Ollama: `11434`
  - Backend: `8080`
  - Frontend: `3000`

**Tip:** The first run may take a while as Docker pulls images and Ollama downloads the model.

---

## 4. Accessing the Application

- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:8080](http://localhost:8080)
- **Ollama UI/API:** [http://localhost:11434](http://localhost:11434)
- **MongoDB:** [mongodb://localhost:27017](mongodb://localhost:27017)

---

## 5. Development Workflow

### Backend

- Source code: `./backend`
- Main dependencies: see `backend/requirements.txt`
- Python version: 3.12 (see `backend/pyproject.toml`)
- To run backend tests:
  ```bash
  cd backend
  pip install -r requirements.txt
  pytest
  ```

### Frontend

- Source code: `./web`
- Main dependencies: see `web/package.json`
- To start the frontend in development mode:
  ```bash
  cd web
  npm install
  npm run dev
  ```
  This starts the Next.js app on [http://localhost:3000](http://localhost:3000).

---

## 6. Initial Data and Seeding

- **MongoDB Initialization:**  
  The `mongo` service mounts `./mongo-init` to `/docker-entrypoint-initdb.d` for initial scripts. Place any `.js` or `.sh` files here to seed data on first run.

- **Ollama Model Pull:**  
  The `ollama-pull` service automatically pulls the model specified by `OLLAMA_MODEL` on startup.

---

## 7. Customization & Advanced Setup

- **Mounting Local Repos:**  
  The backend mounts `${HOST_REPO_ROOT:-.}:/host/repos` for local repo access. Adjust `HOST_REPO_ROOT` in your `.env` if needed.

- **Environment Variables for Frontend:**  
  The frontend uses variables like `BACKEND_BASE_URL`, `POC_DEV_USER`, and `POC_DEV_ADMIN` (see `web/src/app/api/admin/custom-tools/route.ts`). You can set these in a `.env.local` file in `./web` for development overrides.

---

## 8. Stopping and Cleaning Up

To stop all services:

```bash
docker compose down
```

To remove all volumes (including database and vector data):

```bash
docker compose down -v
```

---

## 9. Troubleshooting

- **Ports already in use:**  
  Make sure ports `27017`, `11434`, `8080`, and `3000` are free.
- **Ollama model not found:**  
  Ensure `OLLAMA_MODEL` is set to a valid model name.
- **Backend/Frontend not connecting:**  
  Check that environment variables for service URLs are correct and containers are healthy.

---

## 10. Next Steps

- See [documentation/setup/development.md](development.md) for advanced development workflows.
- See [documentation/setup/docker-compose.md](docker-compose.md) for Docker details.
- Explore [documentation/architecture/overview.md](../architecture/overview.md) for system architecture.

---

You’re ready to start developing with Project QA POC! If you encounter issues
