"use client"

import { Box, Paper, Typography } from "@mui/material"
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from "recharts"

type Point = { x: string | number; y: number }

type Props = {
    title?: string
    data: Point[]
}

export default function ChartMessage({ title, data }: Props) {
    return (
        <Paper variant="outlined" sx={{ width: "100%", p: 1.5 }}>
            {title ? (
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {title}
                </Typography>
            ) : null}
            <Box sx={{ height: 260, width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="y" dot={false} stroke="#80deea" />
                    </LineChart>
                </ResponsiveContainer>
            </Box>
        </Paper>
    )
}
