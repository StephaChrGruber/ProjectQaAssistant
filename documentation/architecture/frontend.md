# Frontend Architecture

This document provides an overview of the frontend architecture for the Local POC Project, focusing on the use of Next.js, React, and related technologies. The frontend is designed to be modular, scalable, and easy to maintain, leveraging modern web development practices.

## Technology Stack

The frontend of the Local POC Project is built using the following technologies:

- **Next.js**: A React framework that enables server-side rendering and static site generation, providing a robust foundation for building web applications.
- **React**: A JavaScript library for building user interfaces, allowing for the creation of reusable UI components.
- **TypeScript**: A typed superset of JavaScript that compiles to plain JavaScript, enhancing code quality and maintainability.
- **Tailwind CSS**: A utility-first CSS framework for rapidly building custom designs.

## Project Structure

The frontend codebase is organized as follows:

- **`web/src`**: Contains the source code for the frontend application.
  - **`app`**: Houses the main application logic and page components.
  - **`components`**: Contains reusable React components used throughout the application.
  - **`styles`**: Includes global styles and Tailwind CSS configurations.
  - **`api`**: Defines API routes using Next.js API routes feature.

## Key Modules and Files

- **`package.json`**: Lists the project's dependencies and scripts. Key dependencies include `next`, `react`, `react-dom`, and `next-auth`.
- **`tsconfig.json`**: Configures TypeScript settings, ensuring strict type checking and compatibility with Next.js.
- **`next.config.js`**: (if present) Configures Next.js settings, such as custom webpack configurations or environment variables.

## Development Workflow

### Running the Development Server

To start the development server, use the following command:

```bash
npm run dev
```

This command will start the Next.js development server on port 3000, allowing you to view the application at `http://localhost:3000`.

### Building for Production

To build the application for production, execute:

```bash
npm run build
```

This command compiles the application into an optimized production build.

### Starting the Production Server

After building the application, you can start the production server with:

```bash
npm run start
```

This will launch the server on port 3000, serving the optimized build.

## API Integration

The frontend communicates with the backend via API routes defined in the `web/src/app/api` directory. These routes handle requests and responses between the frontend and backend services, ensuring seamless data flow.

### Example API Route

The following is an example of an API route for fetching project documentation:

```typescript
// web/src/app/api/projects/[projectId]/documentation/route.ts
import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080";
const DEV_USER = process.env.POC_DEV_USER || "dev@local";

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await ctx.params;
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch");

    const upstream = new URL(`${BACKEND}/projects/${encodeURIComponent(projectId)}/documentation`);
    if (branch) {
        upstream.searchParams.set("branch", branch);
    }

    const res = await fetch(upstream.toString(), {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    });

    const text = await res.text();
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
}
```

This route fetches documentation for a specific project, demonstrating how the frontend interacts with the backend using environment variables for configuration.

## Conclusion

The frontend architecture of the Local POC Project is designed to be efficient and developer-friendly, utilizing modern frameworks and tools. By following the outlined structure and practices, developers can effectively contribute to and maintain the frontend codebase.
