# Frontend Architecture

This document provides an overview of the frontend architecture for **Project QA POC**, focusing on the main technologies (Next.js, React, MUI), API integration patterns, and development conventions. It is intended for developers contributing to or maintaining the frontend codebase.

---

## Technology Stack

- **Next.js** (`web/`): The frontend is built using [Next.js](https://nextjs.org/) (v15), leveraging its hybrid static/server rendering, routing, and API capabilities.
- **React** (v19): All UI components are implemented using React.
- **Material UI (MUI)**: [@mui/material](https://mui.com/) and [@mui/icons-material](https://mui.com/material-ui/material-icons/) are used for UI components and theming.
- **TypeScript**: The codebase is fully typed using TypeScript, with strict type checking enabled via `tsconfig.json`.
- **State Management**: [@tanstack/react-query](https://tanstack.com/query/latest) is used for data fetching and caching.
- **Testing**: [Vitest](https://vitest.dev/) and [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) are used for unit and integration tests.
- **Linting/Formatting**: [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/) are used for code quality and formatting.

---

## Project Structure

The frontend source code is located in the `web/` directory. Key subdirectories and files:

- `web/src/app/`: Next.js app directory (app router).
- `web/src/app/api/`: Next.js API routes (used as backend proxies).
- `web/src/components/`: React UI components.
- `web/src/lib/`: Shared utilities, API clients, and hooks.
- `web/package.json`: Project dependencies and scripts.
- `web/tsconfig.json`: TypeScript configuration.

---

## API Integration

### Backend Proxy Pattern

All backend API calls are routed through Next.js API endpoints under `web/src/app/api/`. This approach provides:

- **Security**: Hides backend URLs and credentials from the browser.
- **Flexibility**: Allows request/response transformation, header injection, and custom caching.
- **Development Convenience**: Enables local development without CORS issues.

#### Example: Custom Tools Admin API

- **Route:** `web/src/app/api/admin/custom-tools/route.ts`
- **Pattern:** Each API route defines `GET`, `POST`, etc., handlers that forward requests to the backend (`BACKEND_BASE_URL`, defaulting to `http://backend:8080`).
- **Headers:** Custom headers like `X-Dev-User` and `X-Dev-Admin` are injected for authentication/authorization.
- **Usage:** Frontend React components call these API routes (e.g., `/api/admin/custom-tools`) instead of calling the backend directly.

#### Dynamic API Routes

- Dynamic segments (e.g., `[toolId]`, `[projectId]`) are used for resource-specific endpoints:
  - `web/src/app/api/admin/custom-tools/[toolId]/route.ts`
  - `web/src/app/api/admin/projects/[projectId]/connectors/route.ts`

#### API Type Generation

- The OpenAPI schema is exported from the backend and used to generate TypeScript types:
  - `npm run api:export` (exports OpenAPI JSON)
  - `npm run api:types` (generates `src/lib/api/generated.ts`)

---

## UI Layer

### Component Library

- **MUI** is the primary component library. Use MUI components for layout, forms, dialogs, tables, etc.
- **Custom Components**: Place reusable UI elements in `web/src/components/`.

### Theming

- Use MUI's theming system for consistent colors, typography, and spacing.
- Theme customization should be done via MUI's `ThemeProvider` at the app root.

### State and Data Fetching

- Use **React Query** (`@tanstack/react-query`) for all asynchronous data fetching and caching.
- Define API hooks in `web/src/lib/` (e.g., `useCustomTools`, `useConnectors`).
- Avoid using React local state for server data; prefer React Query for consistency and cache management.

---

## Routing and Navigation

- **App Router**: Next.js 13+ app directory routing is used (`web/src/app/`).
- **Dynamic Routes**: Use `[param]` syntax for dynamic segments.
- **API Routes**: Place all backend proxy endpoints under `web/src/app/api/`.

---

## Development Conventions

### TypeScript

- All files must use TypeScript (`.ts`/`.tsx`).
- Enable strict type checking (`"strict": true` in `tsconfig.json`).
- Use generated API types for backend responses.

### Linting and Formatting

- Run `npm run lint` before committing.
- Format code with `npm run format`.
- CI should enforce lint and format checks.

### Testing

- Write unit and integration tests using Vitest and Testing Library.
- Place tests alongside components or in a dedicated `__tests__` directory.

### File Naming

- Use kebab-case for file and folder names.
- Use PascalCase for React component files.

### Environment Variables

- Configure environment variables in `.env.local` for local development.
- Key variables:
  - `BACKEND_BASE_URL`: Backend API base URL (default: `http://backend:8080`)
  - `POC_DEV_USER`, `POC_DEV_ADMIN`: Used for development authentication headers.

---

## Setup and Running Locally

1. **Install dependencies:**
   ```
   cd web
   npm install
   ```
2. **Start the frontend in development mode:**
   ```
   npm run dev
   ```
   The app will be available at [http://localhost:3000](http://localhost:3000).

3. **Backend and dependencies** are managed via `docker-compose.yaml` at the project root. See `documentation/setup/getting-started.md` for details.

---

## Summary

- Use Next.js app directory and API routes for all frontend and backend integration.
- Use React, MUI
