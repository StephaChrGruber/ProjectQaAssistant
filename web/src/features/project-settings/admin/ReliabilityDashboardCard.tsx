"use client"

import type { ComponentType } from "react"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material"
import type { QaMetricsResponse } from "@/features/project-settings/form-model"

type ReliabilityDashboardCardProps = {
    qaMetrics: QaMetricsResponse | null
    loadQaMetrics: () => Promise<void>
    loadingQaMetrics: boolean
    DetailCardComponent: ComponentType<{ title: string; value: string }>
}

export default function ReliabilityDashboardCard(props: ReliabilityDashboardCardProps) {
    const { qaMetrics, loadQaMetrics, loadingQaMetrics, DetailCardComponent } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        Reliability Dashboard
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => void loadQaMetrics()}
                        disabled={loadingQaMetrics}
                        startIcon={<RefreshRounded />}
                    >
                        Refresh
                    </Button>
                </Stack>
                {qaMetrics ? (
                    <Box
                        sx={{
                            mt: 1.4,
                            display: "grid",
                            gap: 1.2,
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                        }}
                    >
                        <DetailCardComponent title="Source Coverage" value={`${qaMetrics.source_coverage_pct}%`} />
                        <DetailCardComponent title="Grounded Failures" value={String(qaMetrics.grounded_failures || 0)} />
                        <DetailCardComponent title="Tool Errors" value={String(qaMetrics.tool_errors || 0)} />
                        <DetailCardComponent title="Tool Timeouts" value={String(qaMetrics.tool_timeouts || 0)} />
                        <DetailCardComponent title="Latency Avg / P95" value={`${qaMetrics.tool_latency_avg_ms} / ${qaMetrics.tool_latency_p95_ms} ms`} />
                        <DetailCardComponent title="Avg Tool Calls/Answer" value={String(qaMetrics.avg_tool_calls_per_answer || 0)} />
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.2 }}>
                        {loadingQaMetrics ? "Loading metrics..." : "No reliability metrics yet."}
                    </Typography>
                )}
            </CardContent>
        </Card>
    )
}
