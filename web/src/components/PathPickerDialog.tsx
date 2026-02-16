"use client"

import { useEffect, useMemo, useState } from "react"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItemButton,
    ListItemText,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import HomeRounded from "@mui/icons-material/HomeRounded"
import { backendJson } from "@/lib/backend"

type DirectoryItem = {
    name: string
    path: string
}

type FsListResponse = {
    path: string
    parent: string | null
    roots: string[]
    directories: DirectoryItem[]
}

type Props = {
    open: boolean
    title?: string
    initialPath?: string
    onClose: () => void
    onPick: (path: string) => void
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

export default function PathPickerDialog({
    open,
    title = "Pick Folder",
    initialPath,
    onClose,
    onPick,
}: Props) {
    const [currentPath, setCurrentPath] = useState("")
    const [directories, setDirectories] = useState<DirectoryItem[]>([])
    const [roots, setRoots] = useState<string[]>([])
    const [parentPath, setParentPath] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const effectivePath = useMemo(() => currentPath.trim(), [currentPath])

    async function load(path?: string) {
        setLoading(true)
        setError(null)
        try {
            const query = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : ""
            const res = await backendJson<FsListResponse>(`/api/admin/fs/list${query}`)
            setCurrentPath(res.path || "")
            setDirectories(res.directories || [])
            setRoots(res.roots || [])
            setParentPath(res.parent || null)
        } catch (err) {
            setError(errText(err))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!open) return
        void load(initialPath)
    }, [open, initialPath])

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Stack spacing={1.2} sx={{ mt: 0.5 }}>
                    {error && <Alert severity="error">{error}</Alert>}

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            label="Current Path"
                            value={currentPath}
                            onChange={(e) => setCurrentPath(e.target.value)}
                            fullWidth
                            size="small"
                        />
                        <Button
                            variant="outlined"
                            onClick={() => void load(currentPath)}
                            disabled={loading}
                        >
                            Open
                        </Button>
                    </Stack>

                    <Stack direction="row" spacing={1}>
                        <Button
                            variant="text"
                            startIcon={<HomeRounded />}
                            onClick={() => void load("")}
                            disabled={loading}
                        >
                            Roots
                        </Button>
                        <Button
                            variant="text"
                            startIcon={<ArrowUpwardRounded />}
                            onClick={() => {
                                if (parentPath) void load(parentPath)
                            }}
                            disabled={loading || !parentPath}
                        >
                            Up
                        </Button>
                    </Stack>

                    {loading ? (
                        <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : (
                        <List
                            dense
                            sx={{
                                border: "1px solid",
                                borderColor: "divider",
                                borderRadius: 1.5,
                                maxHeight: 360,
                                overflowY: "auto",
                            }}
                        >
                            {directories.map((item) => (
                                <ListItemButton
                                    key={item.path}
                                    onClick={() => {
                                        setCurrentPath(item.path)
                                        void load(item.path)
                                    }}
                                >
                                    <ListItemText
                                        primary={item.name}
                                        secondary={item.path}
                                        primaryTypographyProps={{ noWrap: true }}
                                        secondaryTypographyProps={{ noWrap: true }}
                                    />
                                    <FolderRounded fontSize="small" />
                                </ListItemButton>
                            ))}

                            {!directories.length && (
                                <ListItemButton disabled>
                                    <ListItemText primary="No subdirectories" />
                                </ListItemButton>
                            )}
                        </List>
                    )}

                    {roots.length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                            Server-side picker (backend filesystem). Allowed roots: {roots.join(", ")}
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={() => onPick(effectivePath)}
                    disabled={!effectivePath}
                >
                    Use This Path
                </Button>
            </DialogActions>
        </Dialog>
    )
}
