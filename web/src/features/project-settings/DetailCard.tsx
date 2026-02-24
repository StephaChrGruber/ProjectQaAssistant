"use client"

import { Card, CardContent, Typography } from "@mui/material"

type DetailCardProps = {
    title: string
    value: string
}

export default function DetailCard({ title, value }: DetailCardProps) {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1, md: 1.2 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em", fontSize: 10.5 }}>
                    {title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, wordBreak: "break-word", fontSize: 12.5 }}>
                    {value}
                </Typography>
            </CardContent>
        </Card>
    )
}
