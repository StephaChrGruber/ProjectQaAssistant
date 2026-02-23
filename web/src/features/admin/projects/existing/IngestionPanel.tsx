"use client"

import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import { Box, Button, Paper, Stack, Typography } from "@mui/material"

type IngestionPanelProps = {
    projectId: string
    busy: boolean
    refreshProjects: (preferredProjectId?: string) => Promise<void>
    runIngest: (projectId: string) => Promise<void>
}

export default function IngestionPanel({ projectId, busy, refreshProjects, runIngest }: IngestionPanelProps) {
    return (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                alignItems={{ xs: "flex-start", sm: "center" }}
                justifyContent="space-between"
            >
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Ingestion
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Pull configured source data and refresh the retrieval index.
                    </Typography>
                </Box>

                <Stack direction="row" spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                    <Button
                        variant="outlined"
                        startIcon={<RefreshRounded />}
                        onClick={() => void refreshProjects(projectId)}
                        disabled={busy}
                        sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                    >
                        Refresh
                    </Button>
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<CloudUploadRounded />}
                        onClick={() => void runIngest(projectId)}
                        disabled={busy}
                        sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                    >
                        Run Ingestion
                    </Button>
                </Stack>
            </Stack>
        </Paper>
    )
}
