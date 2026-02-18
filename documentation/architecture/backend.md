# Backend Architecture

The backend of the Local POC Project is designed to provide a robust and scalable API service using FastAPI, MongoDB, and several other key components. This document outlines the architecture and operational details necessary for developers to understand and work with the backend system.

## Overview

The backend is built using FastAPI, a modern, fast (high-performance), web framework for building APIs with Python 3.6+ based on standard Python type hints. It is designed to be easy to use and to provide a high level of performance.

### Key Components

- **FastAPI**: The core framework used for building the API endpoints.
- **MongoDB**: A NoSQL database used for storing application data. The backend connects to MongoDB using the `motor` library, which is an asynchronous driver for MongoDB.
- **Beanie**: An ODM (Object Document Mapper) for MongoDB, which is used to define and manage data models.
- **Uvicorn**: An ASGI server used to run the FastAPI application.
- **ChromaDB**: Used for managing and querying vector embeddings, which are crucial for certain AI functionalities.

## Directory Structure

- **`backend/app/routes`**: Contains the API route definitions. Each file in this directory corresponds to a specific set of functionalities, such as user management, project management, and AI interactions.
- **`backend/app/models`**: Defines the data models using Beanie, which are used to interact with MongoDB.
- **`backend/app/settings.py`**: Contains configuration settings for the application, including environment variables and default values.

## Environment Configuration

The backend service is configured using environment variables, which are defined in the `docker-compose.yaml` file. Key environment variables include:

- `MONGODB_URI`: The URI for connecting to the MongoDB instance.
- `MONGODB_DB`: The name of the database to use.
- `AUTH_MODE`: The authentication mode for the application.
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`: Configuration for connecting to the language model service.

## Running the Backend

The backend service is containerized using Docker and can be started using Docker Compose. The relevant service definition in `docker-compose.yaml` is as follows:

```yaml
backend:
  build: ./backend
  restart: unless-stopped
  environment:
    - MONGODB_URI=${MONGODB_URI}
    - MONGODB_DB=${MONGODB_DB}
    - AUTH_MODE=${AUTH_MODE}
    - CHROMA_ROOT=${CHROMA_ROOT}
    - WEB_ORIGIN=${WEB_ORIGIN}
    - LLM_BASE_URL=${LLM_BASE_URL}
    - LLM_API_KEY=${LLM_API_KEY}
    - LLM_MODEL=${LLM_MODEL}
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - ANONYMIZED_TELEMETRY=${ANONYMIZED_TELEMETRY}
    - PATH_PICKER_ROOTS=${PATH_PICKER_ROOTS}
    - MONGO_URI=mongodb://mongo:27017
    - MONGO_DB=project_qa
    - ANONYMIZED_TELEMETRY=False
  volumes:
    - chroma_data:/data/chroma_projects
    - ${HOST_REPO_ROOT:-.}:/host/repos
```

## API Endpoints

The backend exposes several API endpoints, organized by functionality:

- **User Management**: Handled in `backend/app/routes/me.py`, providing endpoints for retrieving user information.
- **Project Management**: Defined in `backend/app/routes/admin.py`, allowing for the creation and management of projects.
- **AI Interactions**: Managed in `backend/app/routes/qa.py` and `backend/app/routes/ask_agent.py`, providing endpoints for querying AI models and handling AI-related requests.

## Dependencies

The backend relies on several Python packages, as specified in `backend/requirements.txt`. Key dependencies include:

- `fastapi`: The web framework for building the API.
- `uvicorn`: The server for running the FastAPI application.
- `beanie`: The ODM for MongoDB.
- `motor`: The asynchronous MongoDB driver.
- `PyJWT`: For handling JSON Web Tokens.
- `requests`: For making HTTP requests.
- `chromadb`: For managing vector embeddings.

## Conclusion

This document provides a comprehensive overview of the backend architecture for the Local POC Project. By understanding the components, configuration, and operational details outlined here, developers can effectively contribute to and extend the backend system.
