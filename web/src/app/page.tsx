"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material"
import { readLastChat } from "@/lib/last-chat"
import { useProjectsQuery } from "@/features/projects/hooks"

export default function Home() {
    const router = useRouter()
    const last = useMemo(() => readLastChat(), [])
    const projectsQuery = useProjectsQuery(!last?.path)

    useEffect(() => {
        if (last?.path) {
            router.replace(last.path)
            return
        }

        if (!projectsQuery.isFetched) return
        const first = projectsQuery.data?.[0]
        if (first?._id) {
            router.replace(`/projects/${encodeURIComponent(first._id)}/chat`)
            return
        }

        router.replace("/projects")
    }, [last?.path, projectsQuery.data, projectsQuery.isFetched, router])

    return (
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
            <Paper variant="outlined" sx={{ px: 3, py: 2 }}>
                <Stack direction="row" spacing={1.2} alignItems="center">
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                        Restoring your workspace...
                    </Typography>
                </Stack>
            </Paper>
        </Box>
    )
}
