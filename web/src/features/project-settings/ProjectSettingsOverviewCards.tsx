"use client"

import Link from "next/link"
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded"
import DetailCard from "@/features/project-settings/DetailCard"
import { maskSecret, type ProjectDoc } from "@/features/project-settings/form-model"

type ProjectSettingsOverviewCardsProps = {
    projectId: string
    project: ProjectDoc | null
    projectLabel: string
    isGlobalAdmin: boolean
}

export function ProjectSettingsOverviewCards({
    projectId,
    project,
    projectLabel,
    isGlobalAdmin,
}: ProjectSettingsOverviewCardsProps) {
    return (
        <>
            <Card variant="outlined">
                <CardContent sx={{ p: { xs: 1.1, md: 1.4 } }}>
                    <Typography variant="overline" color="primary.light" sx={{ letterSpacing: "0.1em", fontSize: 10.5 }}>
                        Workspace Settings
                    </Typography>
                    <Typography variant="h4" sx={{ mt: 0.35, fontWeight: 700, fontSize: { xs: "1.2rem", md: "1.5rem" } }}>
                        {projectLabel}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                        Review and configure this project&apos;s assistant behavior.
                    </Typography>
                </CardContent>
            </Card>

            <Card variant="outlined">
                <CardContent sx={{ p: { xs: 1.1, md: 1.4 } }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        Project Snapshot
                    </Typography>
                    <Box
                        sx={{
                            mt: 1,
                            display: "grid",
                            gap: 0.9,
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                        }}
                    >
                        <DetailCard title="Project ID" value={projectId} />
                        <DetailCard title="Default Branch" value={project?.default_branch || "main"} />
                        <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                            <DetailCard title="Local Repo Path" value={project?.repo_path || "not configured"} />
                        </Box>
                        <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                            <DetailCard title="Description" value={project?.description || "No description"} />
                        </Box>
                        <DetailCard title="LLM Provider" value={project?.llm_provider || "default"} />
                        <DetailCard title="LLM Model" value={project?.llm_model || "backend default"} />
                        <DetailCard title="LLM Profile" value={project?.llm_profile_id || "none"} />
                        <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                            <DetailCard title="LLM Base URL" value={project?.llm_base_url || "backend default"} />
                        </Box>
                        <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                            <DetailCard title="LLM API Key" value={maskSecret(project?.llm_api_key)} />
                        </Box>
                    </Box>
                </CardContent>
            </Card>

            {!isGlobalAdmin && (
                <Card variant="outlined">
                    <CardContent sx={{ p: { xs: 1.1, md: 1.4 } }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            Sources
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.65 }}>
                            Source connectors are managed by a global admin.
                        </Typography>
                        <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 0.9 }}>
                            <Chip label="Git" color="primary" variant="outlined" />
                            <Chip label="Bitbucket" color="primary" variant="outlined" />
                            <Chip label="Azure DevOps" color="primary" variant="outlined" />
                            <Chip label="Local Repo" color="primary" variant="outlined" />
                            <Chip label="Confluence" color="primary" variant="outlined" />
                            <Chip label="Jira" color="primary" variant="outlined" />
                        </Stack>
                        <Stack
                            direction="row"
                            spacing={0.7}
                            useFlexGap
                            flexWrap="wrap"
                            sx={{ mt: 1.15, "& .MuiButton-root": { width: { xs: "100%", sm: "auto" } } }}
                        >
                            <Button component={Link} href={`/projects/${projectId}/chat`} variant="contained">
                                Open Chat
                            </Button>
                            <Button component={Link} href="/admin" variant="outlined" endIcon={<OpenInNewRounded />}>
                                Open Admin Workflow
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>
            )}
        </>
    )
}
