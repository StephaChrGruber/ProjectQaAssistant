"use client"

import { useEffect } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material"

export default function ProjectChatRedirectPage() {
    const router = useRouter()
    const params = useParams<{ projectId: string }>()
    const searchParams = useSearchParams()
    const projectId = String(params.projectId || "")
    const branch = String(searchParams.get("branch") || "main")

    useEffect(() => {
        if (!projectId) {
            router.replace("/chat")
            return
        }
        router.replace(`/chat?project_id=${encodeURIComponent(projectId)}&branch=${encodeURIComponent(branch)}`)
    }, [branch, projectId, router])

    return (
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
            <Paper variant="outlined" sx={{ px: 3, py: 2 }}>
                <Stack direction="row" spacing={1.2} alignItems="center">
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                        Redirecting to global chat...
                    </Typography>
                </Stack>
            </Paper>
        </Box>
    )
}
