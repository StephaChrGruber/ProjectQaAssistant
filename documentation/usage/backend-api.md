# Backend API Documentation

This document provides an overview of the backend API endpoints for the Local POC Project. It includes details on the purpose of each endpoint, request and response formats, and authentication requirements.

## Overview

The backend API is built using FastAPI and serves as the core service for handling data operations and business logic. It interacts with a MongoDB database and provides endpoints for various functionalities, including project management, documentation generation, and SCIM compliance.

## Base URL

All API endpoints are prefixed with the base URL:

```
http://backend:8080
```

## Authentication

The API uses a simple authentication mechanism where requests must include a custom header:

- `X-Dev-User`: This header should contain the email of the developer making the request. For local development, the default user is `dev@local`.

## Endpoints

### 1. Project Management

#### Get Project Details

- **Endpoint**: `/projects/{projectId}`
- **Method**: `GET`
- **Description**: Retrieves details of a specific project.
- **Request Headers**:
  - `X-Dev-User`: Developer's email.
- **Response**: JSON object containing project details.

#### List All Projects

- **Endpoint**: `/projects`
- **Method**: `GET`
- **Description**: Lists all available projects.
- **Request Headers**:
  - `X-Dev-User`: Developer's email.
- **Response**: JSON array of projects.

### 2. Documentation Management

#### Generate Documentation

- **Endpoint**: `/projects/{projectId}/documentation/generate`
- **Method**: `POST`
- **Description**: Triggers the generation of documentation for a project.
- **Request Headers**:
  - `X-Dev-User`: Developer's email.
  - `Content-Type`: `application/json`
- **Request Body**: JSON object with generation parameters.
- **Response**: Status message indicating success or failure.

#### Fetch Documentation

- **Endpoint**: `/projects/{projectId}/documentation`
- **Method**: `GET`
- **Description**: Fetches the documentation for a specific project.
- **Request Headers**:
  - `X-Dev-User`: Developer's email.
- **Response**: Documentation content in JSON format.

### 3. SCIM Compliance

#### Service Provider Configuration

- **Endpoint**: `/scim/v2/ServiceProviderConfig`
- **Method**: `GET`
- **Description**: Provides the SCIM service provider configuration.
- **Response**: JSON object with SCIM configuration details.

### 4. Chat Management

#### Ensure Chat Document

- **Endpoint**: `/chats/ensure-doc`
- **Method**: `POST`
- **Description**: Ensures a chat document exists.
- **Request Headers**:
  - `X-Dev-User`: Developer's email.
  - `Content-Type`: `application/json`
- **Request Body**: JSON object with chat details.
- **Response**: Status message indicating success or failure.

## Environment Variables

The backend service relies on several environment variables for configuration:

- `MONGODB_URI`: URI for connecting to MongoDB.
- `MONGODB_DB`: Name of the MongoDB database.
- `AUTH_MODE`: Authentication mode for the API.
- `LLM_BASE_URL`: Base URL for the language model service.
- `LLM_API_KEY`: API key for accessing the language model service.

## Conclusion

This document serves as a guide for developers interacting with the backend API. Ensure that all requests include the necessary headers and follow the specified formats for successful operations. For further assistance, refer to the source code or contact the development team.
