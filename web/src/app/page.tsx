"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material"
import { readLastChat } from "@/lib/last-chat"
import { backendJson } from "@/lib/backend"

type ProjectDoc = {
    _id: string
    default_branch?: string
}

export default function Home() {
    const router = useRouter()

    useEffect(() => {
        let cancelled = false

        async function go() {
            const last = readLastChat()
            if (last?.path) {
                router.replace(last.path)
                return
            }

            try {
                const projects = await backendJson<ProjectDoc[]>("/api/projects")
                if (cancelled) return
                const first = projects[0]
                if (first?._id) {
                    router.replace(`/projects/${encodeURIComponent(first._id)}/chat`)
                    return
                }
            } catch {
                // Fallback below.
            }

            if (!cancelled) {
                router.replace("/projects")
            }
        }

        void go()
        return () => {
            cancelled = true
        }
    }, [router])

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
