"use client"

import Link from "next/link"
import { Box, Button, Paper, Stack, Typography } from "@mui/material"
import AddRounded from "@mui/icons-material/AddRounded"
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"

export function AdminWorkflowHeader() {
    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
            <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="space-between"
            >
                <Box>
                    <Typography variant="overline" color="primary.light" sx={{ letterSpacing: "0.14em" }}>
                        Admin Workflow
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5, fontSize: { xs: "1.6rem", md: "2.1rem" } }}>
                        Project + Source Configuration
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Create projects, configure GitHub/Bitbucket/Azure DevOps/Local/Confluence/Jira sources,
                        choose model provider or reusable profile, and run ingestion.
                    </Typography>
                </Box>

                <Stack direction="row" spacing={1}>
                    <Button
                        component={Link}
                        href="/admin/custom-tools"
                        variant="contained"
                        startIcon={<AddRounded />}
                    >
                        Custom Tools
                    </Button>
                    <Button
                        component={Link}
                        href="/projects"
                        variant="outlined"
                        startIcon={<ArrowBackRounded />}
                    >
                        Back to projects
                    </Button>
                </Stack>
            </Stack>
        </Paper>
    )
}

