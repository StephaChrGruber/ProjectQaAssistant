"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material"

export default function Home() {
    const router = useRouter()

    useEffect(() => {
        router.replace("/chat")
    }, [router])

    return (
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
            <Paper variant="outlined" sx={{ px: 3, py: 2 }}>
                <Stack direction="row" spacing={1.2} alignItems="center">
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                        Opening global chat...
                    </Typography>
                </Stack>
            </Paper>
        </Box>
    )
}
