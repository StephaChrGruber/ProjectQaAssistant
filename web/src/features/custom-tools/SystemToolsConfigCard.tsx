"use client"

import { Box, Card, CardContent, Divider, Paper, Stack, Switch, Typography } from "@mui/material"
import type { SystemToolRow } from "./types"

type SystemToolsConfigCardProps = {
    systemTools: SystemToolRow[]
    busy: boolean
    projectFilter: string
    onUpdateTool: (name: string, patch: Partial<SystemToolRow>) => Promise<void>
}

export function SystemToolsConfigCard({
    systemTools,
    busy,
    projectFilter,
    onUpdateTool,
}: SystemToolsConfigCardProps) {
    return (
        <Card variant="outlined">
            <CardContent>
                <Stack spacing={1.1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Built-in Tool Load Config
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Built-in tools are now loaded from configuration, just like custom tools.
                        {projectFilter
                            ? " You are editing project-specific overrides."
                            : " Select a project scope to create project-specific overrides."}
                    </Typography>
                    <Divider />
                    <Stack spacing={1}>
                        {systemTools.map((tool) => (
                            <Paper
                                key={`${tool.projectId || "global"}:${tool.name}`}
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    display: "grid",
                                    gridTemplateColumns: { xs: "1fr", md: "1fr auto auto" },
                                    gap: 1,
                                    alignItems: "center",
                                }}
                            >
                                <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                        {tool.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {tool.description || "No description"}
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="caption">Enabled</Typography>
                                    <Switch
                                        size="small"
                                        checked={tool.isEnabled}
                                        onChange={(e) => void onUpdateTool(tool.name, { isEnabled: e.target.checked })}
                                        disabled={busy || !projectFilter}
                                    />
                                </Stack>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="caption">Approval</Typography>
                                    <Switch
                                        size="small"
                                        checked={tool.requireApproval}
                                        onChange={(e) => void onUpdateTool(tool.name, { requireApproval: e.target.checked })}
                                        disabled={busy || !projectFilter}
                                    />
                                </Stack>
                            </Paper>
                        ))}
                        {!systemTools.length && (
                            <Typography variant="body2" color="text.secondary">
                                No system tools loaded.
                            </Typography>
                        )}
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    )
}
