import { useQuery } from "@tanstack/react-query"
import { fetchProjects } from "@/features/projects/api"

export function useProjectsQuery(enabled = true) {
  return useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled,
  })
}

