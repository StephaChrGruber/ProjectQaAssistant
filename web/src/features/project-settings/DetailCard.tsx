"use client"

import { Card, CardContent, Typography } from "@mui/material"

type DetailCardProps = {
    title: string
    value: string
}

export default function DetailCard({ title, value }: DetailCardProps) {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.1em" }}>
                    {title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.8, wordBreak: "break-word" }}>
                    {value}
                </Typography>
            </CardContent>
        </Card>
    )
}
