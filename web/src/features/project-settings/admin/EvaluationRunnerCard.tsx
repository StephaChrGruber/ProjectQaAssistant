"use client"

import type { ComponentType, Dispatch, SetStateAction } from "react"
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material"
import type { EvalRunResponse } from "@/features/project-settings/form-model"

type EvaluationRunnerCardProps = {
    evaluationQuestions: string
    setEvaluationQuestions: Dispatch<SetStateAction<string>>
    runEvaluations: () => Promise<void>
    runningEvaluations: boolean
    latestEvalRun: EvalRunResponse | null
    DetailCardComponent: ComponentType<{ title: string; value: string }>
}

export default function EvaluationRunnerCard(props: EvaluationRunnerCardProps) {
    const {
        evaluationQuestions,
        setEvaluationQuestions,
        runEvaluations,
        runningEvaluations,
        latestEvalRun,
        DetailCardComponent,
    } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Evaluation Runner
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                    Run regression questions and track grounded/source coverage trends.
                </Typography>
                <TextField
                    label="Questions (one per line)"
                    multiline
                    minRows={4}
                    value={evaluationQuestions}
                    onChange={(e) => setEvaluationQuestions(e.target.value)}
                    sx={{ mt: 1.3 }}
                    fullWidth
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                    <Button
                        variant="contained"
                        onClick={() => void runEvaluations()}
                        disabled={runningEvaluations}
                    >
                        {runningEvaluations ? "Running..." : "Run Evaluations"}
                    </Button>
                </Stack>
                {latestEvalRun?.summary && (
                    <Box
                        sx={{
                            mt: 1.3,
                            display: "grid",
                            gap: 1.1,
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                        }}
                    >
                        <DetailCardComponent title="Questions" value={String(latestEvalRun.summary.total || 0)} />
                        <DetailCardComponent title="Source Coverage" value={`${latestEvalRun.summary.source_coverage_pct || 0}%`} />
                        <DetailCardComponent title="Avg Latency" value={`${latestEvalRun.summary.avg_latency_ms || 0} ms`} />
                    </Box>
                )}
            </CardContent>
        </Card>
    )
}
