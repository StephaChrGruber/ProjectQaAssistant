# Local POC Project

Welcome to the Local POC Project! This project serves as a proof of concept for integrating various backend and frontend technologies to create a robust and scalable application. Below, you'll find an overview of the project's purpose, main features, and guidance on navigating the documentation.

## Project Purpose

The Local POC Project aims to demonstrate the integration of a FastAPI backend with a Next.js frontend, utilizing MongoDB for data storage and various third-party services for enhanced functionality. This setup is designed to provide a comprehensive example of a modern web application architecture.

## Main Features

- **Backend**: Built with FastAPI, the backend provides a RESTful API for managing project data. It includes features such as user authentication, project management, and integration with external services like OpenAI and Ollama.
- **Frontend**: Developed using Next.js, the frontend offers a responsive and interactive user interface. It leverages React and various UI libraries to deliver a seamless user experience.
- **Database**: MongoDB is used as the primary data store, ensuring scalability and flexibility in data management.
- **Containerization**: The project utilizes Docker for containerization, allowing for easy deployment and management of services.

## Navigating the Documentation

The documentation is organized into several sections to help you get started and make the most of the project:

- **Architecture**: 
  - [Overview](architecture/overview.md): Provides a high-level view of the system architecture.
  - [Backend](architecture/backend.md): Details the backend structure and components.
  - [Frontend](architecture/frontend.md): Describes the frontend architecture and technologies used.

- **Setup**:
  - [Getting Started](setup/getting-started.md): Instructions for setting up the development environment.
  - [Docker](setup/docker.md): Guide on using Docker to run the project services.

- **Usage**:
  - [Backend API](usage/backend-api.md): Documentation on available API endpoints and their usage.
  - [Frontend](usage/frontend.md): Information on using and extending the frontend application.

- **Development**:
  - [Contributing](development/contributing.md): Guidelines for contributing to the project.
  - [Testing](development/testing.md): Instructions for running tests and ensuring code quality.

## Setup and Operational Details

To get started with the project, ensure you have Docker installed. The `docker-compose.yaml` file orchestrates the services, including MongoDB, the backend, and the frontend. Use the following command to start the services:

```bash
docker-compose up --build
```

This command will build and start all services defined in the `docker-compose.yaml` file. The backend will be accessible at `http://localhost:8080`, and the frontend at `http://localhost:3000`.

For more detailed setup instructions, refer to the [Getting Started](setup/getting-started.md) guide.

We hope this documentation helps you navigate and utilize the Local POC Project effectively. Happy coding!
