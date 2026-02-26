"use client"

import { Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material"
import AddRounded from "@mui/icons-material/AddRounded"
import type { CustomToolRow } from "./types"

type ToolSelectorCardProps = {
    tools: CustomToolRow[]
    selectedToolId: string
    onSelectTool: (toolId: string) => void
    onCreateNew: () => void
}

export function ToolSelectorCard({ tools, selectedToolId, onSelectTool, onCreateNew }: ToolSelectorCardProps) {
    return (
        <Card variant="outlined">
            <CardContent>
                <Stack spacing={1.2}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            Available Tools
                        </Typography>
                        <Button startIcon={<AddRounded />} size="small" onClick={onCreateNew}>
                            New
                        </Button>
                    </Stack>
                    <Divider />
                    <Stack spacing={1}>
                        {tools.map((tool) => (
                            <Button
                                key={tool.id}
                                variant={selectedToolId === tool.id ? "contained" : "outlined"}
                                onClick={() => onSelectTool(tool.id)}
                                sx={{ justifyContent: "space-between" }}
                            >
                                <span>{tool.name}</span>
                                <Stack direction="row" spacing={0.5}>
                                    {tool.classKey ? <Chip size="small" label={tool.classKey} variant="outlined" /> : null}
                                    <Chip
                                        size="small"
                                        label={tool.runtime === "local_typescript" ? "Local TS" : "Backend Py"}
                                        color={tool.runtime === "local_typescript" ? "secondary" : "primary"}
                                        variant="outlined"
                                    />
                                </Stack>
                            </Button>
                        ))}
                        {!tools.length && (
                            <Typography variant="body2" color="text.secondary">
                                No custom tools found for this scope.
                            </Typography>
                        )}
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    )
}
