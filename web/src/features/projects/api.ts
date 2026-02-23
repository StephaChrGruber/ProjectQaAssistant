import { apiGet } from "@/lib/api/client"

export type ProjectDoc = {
  _id: string
  default_branch?: string
}

export function fetchProjects(): Promise<ProjectDoc[]> {
  return apiGet<ProjectDoc[]>("/api/projects")
}

