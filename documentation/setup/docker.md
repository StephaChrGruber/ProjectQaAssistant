# Docker Setup Guide for Local POC Project

This document provides detailed instructions for setting up and running the Local POC Project using Docker. The setup utilizes `docker-compose` to manage multiple services required by the project.

## Prerequisites

Ensure you have the following installed on your system:

- Docker: [Installation Guide](https://docs.docker.com/get-docker/)
- Docker Compose: [Installation Guide](https://docs.docker.com/compose/install/)

## Docker Compose Configuration

The `docker-compose.yaml` file defines the services required for the project. Below is an overview of the services and their configurations:

### Services

1. **MongoDB**
   - **Image**: `mongo:7`
   - **Ports**: Exposes port `27017` for database connections.
   - **Volumes**: 
     - `mongo_data` for persistent storage.
     - `./mongo-init` for initialization scripts.

2. **Ollama**
   - **Image**: `ollama/ollama:latest`
   - **Ports**: Exposes port `11434`.
   - **Volumes**: `ollama_data` for persistent storage.

3. **Ollama Pull**
   - **Image**: `ollama/ollama:latest`
   - **Depends on**: Ollama service.
   - **Environment Variables**:
     - `OLLAMA_HOST`: Set to `http://ollama:11434`.
     - `OLLAMA_MODEL`: Model to be pulled.
   - **Volumes**: Shares `ollama_data` with the Ollama service.
   - **Entrypoint**: Executes `ollama pull` command to fetch the specified model.

4. **Backend**
   - **Build Context**: `./backend`
   - **Environment Variables**:
     - `MONGODB_URI`: Connection string for MongoDB.
     - `MONGODB_DB`: Database name.
     - Additional environment variables for authentication and API configurations.
   - **Volumes**:
     - `chroma_data` for Chroma projects.
     - `${HOST_REPO_ROOT:-.}` for host repository access.

## Running the Project

To start the project using Docker Compose, follow these steps:

1. **Clone the Repository**: Ensure you have the project repository cloned locally.

2. **Navigate to the Project Directory**: Open a terminal and change to the directory containing the `docker-compose.yaml` file.

3. **Start Services**: Run the following command to start all services defined in the `docker-compose.yaml` file:
   ```bash
   docker-compose up -d
   ```
   The `-d` flag runs the services in detached mode.

4. **Verify Services**: Check the status of the services to ensure they are running correctly:
   ```bash
   docker-compose ps
   ```

5. **Access the Application**: Once all services are up, you can access the application through the configured ports. For example, the backend service can be accessed at `http://localhost:8080`.

## Stopping the Services

To stop the running services, execute:
```bash
docker-compose down
```
This command stops and removes all containers defined in the `docker-compose.yaml`.

## Additional Notes

- **Environment Variables**: Ensure all required environment variables are set in your `.env` file or directly in the `docker-compose.yaml`.
- **Data Persistence**: Volumes are used to persist data across container restarts. Ensure volumes are correctly configured to avoid data loss.

By following these instructions, you should be able to set up and run the Local POC Project using Docker efficiently. For any issues or further customization, refer to the Docker and Docker Compose documentation.
