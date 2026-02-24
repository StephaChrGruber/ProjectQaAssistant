"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Chip,
    Container,
    Stack,
    Typography,
} from "@mui/material"
import PlayCircleOutlineRounded from "@mui/icons-material/PlayCircleOutlineRounded"
import SettingsRounded from "@mui/icons-material/SettingsRounded"
import HistoryRounded from "@mui/icons-material/HistoryRounded"
import { backendJson } from "@/lib/backend"
import { readLastChat } from "@/lib/last-chat"

type Project = {
    _id: string
    key?: string
    name?: string
    description?: string
    default_branch?: string
    llm_provider?: string
    llm_model?: string
}

type MeResponse = {
    user?: {
        displayName?: string
        email?: string
        isGlobalAdmin?: boolean
    }
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

export default function ProjectsPage() {
    const router = useRouter()
    const [projects, setProjects] = useState<Project[]>([])
    const [me, setMe] = useState<MeResponse["user"] | null>(null)
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setLoading(true)
            setErr(null)
            try {
                const [meRes, projectRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<Project[]>("/api/projects"),
                ])
                if (cancelled) return
                setMe(meRes.user || null)
                setProjects(projectRes)
            } catch (e) {
                if (!cancelled) setErr(errText(e))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [])

    const userLabel = useMemo(() => me?.displayName || me?.email || "Developer", [me])
    const hasLastChat = useMemo(() => Boolean(readLastChat()?.path), [])

    return (
        <Box sx={{ minHeight: "100vh", py: { xs: 1.2, md: 1.8 } }}>
            <Container maxWidth="xl">
                <Stack spacing={{ xs: 1.3, md: 1.7 }}>
                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.1, md: 1.4 } }}>
                            <Stack
                                direction={{ xs: "column", md: "row" }}
                                spacing={1.2}
                                alignItems={{ xs: "flex-start", md: "center" }}
                                justifyContent="space-between"
                            >
                                <Box>
                                    <Typography variant="overline" color="primary.light" sx={{ letterSpacing: "0.1em", fontSize: 10.5 }}>
                                        Project QA Assistant
                                    </Typography>
                                    <Typography variant="h4" sx={{ mt: 0.35, fontWeight: 700, fontSize: { xs: "1.2rem", md: "1.5rem" } }}>
                                        Workspaces
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55 }}>
                                        Open a project chat with branch-aware retrieval over GitHub/Bitbucket/Azure DevOps, local repo, Confluence, and Jira.
                                    </Typography>
                                </Box>

                                <Stack spacing={0.7} sx={{ minWidth: { xs: "100%", md: 260 }, alignItems: { xs: "stretch", md: "flex-end" } }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: { md: "right" } }}>
                                        {userLabel}
                                    </Typography>
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        useFlexGap
                                        flexWrap="wrap"
                                        justifyContent={{ md: "flex-end" }}
                                        sx={{ "& .MuiButton-root": { width: { xs: "100%", sm: "auto" } } }}
                                    >
                                        {hasLastChat && (
                                            <Button
                                                variant="contained"
                                                startIcon={<HistoryRounded />}
                                                onClick={() => {
                                                    const last = readLastChat()
                                                    if (last?.path) router.push(last.path)
                                                }}
                                            >
                                                Resume Last Chat
                                            </Button>
                                        )}
                                    </Stack>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>

                    {err && <Alert severity="error">{err}</Alert>}

                    {loading && <Alert severity="info">Loading projects...</Alert>}

                    {!loading && !err && projects.length === 0 && (
                        <Alert severity="warning">No projects found. Create one in the admin workflow.</Alert>
                    )}

                    <Box
                        sx={{
                            display: "grid",
                            gap: 1.2,
                            gridTemplateColumns: {
                                xs: "1fr",
                                sm: "repeat(2, minmax(0, 1fr))",
                                xl: "repeat(3, minmax(0, 1fr))",
                            },
                        }}
                    >
                        {projects.map((p) => (
                            <Card key={p._id} variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                                <CardContent sx={{ pb: 1.1, p: { xs: 1.1, md: 1.35 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: "0.95rem", sm: "1.04rem" } }}>
                                        {p.name || p.key || p._id}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                        {p._id}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                        {p.description || "No description"}
                                    </Typography>

                                    <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 0.85 }}>
                                        <Chip
                                            size="small"
                                            label={`${(p.llm_provider || "default").toUpperCase()}${p.llm_model ? ` · ${p.llm_model}` : ""}`}
                                            color="primary"
                                            variant="outlined"
                                        />
                                        <Chip size="small" label={p.default_branch || "main"} variant="outlined" />
                                    </Stack>
                                </CardContent>

                                <CardActions
                                    sx={{
                                        px: { xs: 1.1, md: 1.35 },
                                        pb: { xs: 1.1, md: 1.35 },
                                        mt: "auto",
                                        flexWrap: "wrap",
                                        gap: 0.7,
                                        "& .MuiButton-root": { flex: { xs: 1, sm: "0 0 auto" } },
                                    }}
                                >
                                    <Button
                                        component={Link}
                                        href={`/projects/${p._id}/chat`}
                                        variant="contained"
                                        startIcon={<PlayCircleOutlineRounded />}
                                    >
                                        Open Chat
                                    </Button>
                                    <Button
                                        component={Link}
                                        href={`/projects/${p._id}/settings`}
                                        variant="outlined"
                                        startIcon={<SettingsRounded />}
                                    >
                                        Settings
                                    </Button>
                                </CardActions>
                            </Card>
                        ))}
                    </Box>
                </Stack>
            </Container>
        </Box>
    )
}
