# Getting Started with Local POC Project

Welcome to the Local POC Project! This guide will walk you through the initial setup process, including the installation of dependencies and running the project locally. Follow these steps to get your development environment up and running.

## Prerequisites

Before you begin, ensure you have the following installed on your machine:

- **Docker**: Required for containerized services.
- **Node.js**: Version 16 or higher is recommended.
- **Python**: Version 3.8 or higher.
- **Git**: For version control.

## Clone the Repository

Start by cloning the repository to your local machine:

```bash
git clone <repository-url>
cd <repository-directory>
```

## Setting Up the Backend

The backend is built using FastAPI and requires several Python dependencies.

1. **Navigate to the backend directory**:

   ```bash
   cd backend
   ```

2. **Install Python dependencies**:

   Ensure you have a virtual environment set up, then install the required packages:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   pip install -r requirements.txt
   ```

3. **Environment Variables**:

   Create a `.env` file in the `backend` directory with the following content:

   ```env
   MONGODB_URI=mongodb://mongo:27017
   MONGODB_DB=project_qa
   AUTH_MODE=local
   ```

## Setting Up the Frontend

The frontend is a Next.js application.

1. **Navigate to the web directory**:

   ```bash
   cd ../web
   ```

2. **Install Node.js dependencies**:

   Run the following command to install the necessary packages:

   ```bash
   npm install
   ```

3. **Environment Variables**:

   Create a `.env.local` file in the `web` directory with the following content:

   ```env
   BACKEND_BASE_URL=http://localhost:8080
   ```

## Running the Project

### Using Docker

The easiest way to run the project is by using Docker Compose, which will handle both the backend and the database.

1. **Navigate to the root directory**:

   ```bash
   cd ..
   ```

2. **Start the services**:

   Run the following command to start all services defined in the `docker-compose.yaml` file:

   ```bash
   docker-compose up --build
   ```

   This will start the MongoDB, backend, and any other services defined.

### Running Locally

If you prefer to run the services locally without Docker:

1. **Start the backend**:

   In the `backend` directory, activate your virtual environment and run:

   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
   ```

2. **Start the frontend**:

   In the `web` directory, run:

   ```bash
   npm run dev
   ```

   This will start the Next.js development server on port 3000.

## Accessing the Application

- **Frontend**: Open your browser and navigate to `http://localhost:3000`.
- **Backend API**: Access the API documentation at `http://localhost:8080/docs`.

## Conclusion

You are now set up to start developing with the Local POC Project. For further details on architecture and usage, refer to the other documentation files listed in the project. Happy coding!
