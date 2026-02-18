# Project Architecture Overview

This document provides an overview of the architecture for the Local POC Project, detailing both the backend and frontend components and their interactions.

## Architecture Components

### Backend

The backend is built using FastAPI, a modern, fast (high-performance), web framework for building APIs with Python 3.6+ based on standard Python type hints. The backend services are containerized using Docker and orchestrated with Docker Compose.

#### Key Components

- **FastAPI**: The core of the backend, handling API requests and responses.
- **MongoDB**: Used as the primary database, running in a Docker container. It stores all persistent data required by the application.
- **ChromaDB**: A vector database used for handling embeddings and semantic search capabilities.
- **Ollama**: A service for handling language model operations, running in a separate container.

#### Environment Configuration

The backend relies on several environment variables for configuration, including:

- `MONGODB_URI` and `MONGODB_DB`: Connection details for MongoDB.
- `LLM_BASE_URL` and `LLM_API_KEY`: Configuration for language model services.
- `WEB_ORIGIN`: Specifies the allowed origins for CORS.

These are defined in the `docker-compose.yaml` file and can be customized as needed.

#### Dependencies

The backend dependencies are managed using `requirements.txt`, which includes:

- `fastapi`
- `uvicorn`
- `beanie` for ODM (Object Document Mapper) with MongoDB.
- `motor` for asynchronous MongoDB operations.
- `chromadb` for vector database operations.

### Frontend

The frontend is developed using Next.js, a React framework that enables functionality such as server-side rendering and generating static websites for React-based web applications.

#### Key Components

- **Next.js**: Provides the structure for the frontend application, enabling server-side rendering and static site generation.
- **React**: The library for building user interfaces.
- **Material-UI**: A popular React UI framework used for styling and layout.

#### Development and Build

The frontend is configured with a `package.json` file that includes scripts for development, building, and starting the application:

- `dev`: Runs the development server.
- `build`: Compiles the application for production.
- `start`: Starts the production server.

#### TypeScript

The frontend uses TypeScript for type safety, with configuration specified in `tsconfig.json`. This includes settings for module resolution, JSX handling, and strict type checking.

### Interaction Between Components

The backend and frontend communicate primarily through RESTful API endpoints. The frontend makes HTTP requests to the backend to fetch and manipulate data. The backend is configured to handle requests from the frontend, with CORS settings allowing requests from specified origins.

#### API Endpoints

The backend exposes several API endpoints, such as:

- `/api/projects`: For managing project data.
- `/api/ask_agent`: For querying the language model.
- `/api/me`: For user-specific operations.

These endpoints are defined in the backend's FastAPI application and are accessed by the frontend using fetch requests.

## Conclusion

The architecture of the Local POC Project is designed to be modular and scalable, leveraging modern frameworks and technologies to ensure high performance and ease of development. The use of Docker and Docker Compose facilitates easy deployment and management of services, while the combination of FastAPI and Next.js provides a robust foundation for both backend and frontend development.
