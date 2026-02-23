"use client"

import { Box, Paper, Typography } from "@mui/material"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"
import { parseChartSpec } from "@/features/chat/utils"

type Props = {
    value: string
}

export function ChatChartBlock({ value }: Props) {
    const spec = parseChartSpec(value)
    return (
        <Paper variant="outlined" sx={{ p: 1.2, bgcolor: "rgba(0,0,0,0.16)" }}>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
                CHART BLOCK
            </Typography>
            {spec ? (
                <Box sx={{ mt: 1.1, width: "100%", minWidth: 280 }}>
                    {spec.title && (
                        <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                            {spec.title}
                        </Typography>
                    )}
                    <ResponsiveContainer width="100%" height={spec.height || 280}>
                        {spec.type === "bar" ? (
                            <BarChart data={spec.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey={spec.xKey} />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                {spec.series.map((s, sidx) => (
                                    <Bar
                                        key={s.key}
                                        dataKey={s.key}
                                        name={s.label || s.key}
                                        fill={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                    />
                                ))}
                            </BarChart>
                        ) : (
                            <LineChart data={spec.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey={spec.xKey} />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                {spec.series.map((s, sidx) => (
                                    <Line
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label || s.key}
                                        stroke={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                ))}
                            </LineChart>
                        )}
                    </ResponsiveContainer>
                </Box>
            ) : (
                <Box
                    component="pre"
                    sx={{
                        mt: 0.8,
                        mb: 0,
                        overflowX: "auto",
                        whiteSpace: "pre",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 12,
                    }}
                >
                    {value}
                </Box>
            )}
        </Paper>
    )
}

