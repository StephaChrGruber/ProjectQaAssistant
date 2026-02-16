"use client"

import { useState } from "react"
import {
    Alert,
    Box,
    Button,
    FormControl,
    InputLabel,
    Link,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Typography,
} from "@mui/material"

type Project = { id: string; key: string; name: string }

type SourceItem = {
    n?: string | number
    url?: string
    title?: string
    source?: string
}

type AskResponse = {
    answer?: string
    sources?: SourceItem[]
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

export default function ProjectPicker({ initialProjects }: { initialProjects: Project[] }) {
    const [projectId, setProjectId] = useState(initialProjects?.[0]?.id ?? "")
    const [question, setQuestion] = useState("")
    const [answer, setAnswer] = useState<string | null>(null)
    const [sources, setSources] = useState<SourceItem[]>([])
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    async function ask() {
        setLoading(true)
        setErr(null)
        setAnswer(null)
        setSources([])

        try {
            const res = await fetch("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({ projectId, question, topK: 6 }),
                headers: { "Content-Type": "application/json" },
            })
            if (!res.ok) throw new Error(await res.text())
            const data = (await res.json()) as AskResponse
            setAnswer(data.answer || null)
            setSources(data.sources || [])
        } catch (e) {
            setErr(errText(e))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Box sx={{ mt: 2, maxWidth: 900 }}>
            <Stack spacing={1.5}>
                <FormControl size="small" fullWidth>
                    <InputLabel id="project-picker-label">Project</InputLabel>
                    <Select
                        labelId="project-picker-label"
                        label="Project"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                    >
                        {initialProjects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.key} - {p.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <TextField
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask something..."
                    fullWidth
                    multiline
                    minRows={4}
                />

                <Box>
                    <Button onClick={() => void ask()} disabled={!projectId || !question.trim() || loading} variant="contained">
                        {loading ? "Thinking..." : "Ask"}
                    </Button>
                </Box>

                {err && <Alert severity="error">{err}</Alert>}

                {answer && (
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            Answer
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                            {answer}
                        </Typography>

                        <Typography variant="subtitle1" sx={{ mt: 2, fontWeight: 700 }}>
                            Sources
                        </Typography>
                        <Stack component="ul" spacing={0.6} sx={{ mt: 1, pl: 2 }}>
                            {sources.map((s, idx) => (
                                <Typography component="li" variant="body2" key={`${s.n || idx}-${idx}`}>
                                    [{s.n ?? idx + 1}] {s.url ? <Link href={s.url}>{s.title || s.url}</Link> : s.title || "Untitled"}
                                    {s.source ? ` (${s.source})` : ""}
                                </Typography>
                            ))}
                        </Stack>
                    </Paper>
                )}
            </Stack>
        </Box>
    )
}
