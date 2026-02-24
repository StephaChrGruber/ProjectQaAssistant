"use client"

import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded"
import AppDialogTitle from "@/components/AppDialogTitle"

type DeleteProjectDialogProps = {
    open: boolean
    busy: boolean
    projectKey: string
    confirmKey: string
    setConfirmKey: (value: string) => void
    onClose: () => void
    onDelete: () => Promise<void>
}

export default function DeleteProjectDialog(props: DeleteProjectDialogProps) {
    const { open, busy, projectKey, confirmKey, setConfirmKey, onClose, onDelete } = props

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <AppDialogTitle title="Delete Project" onClose={onClose} closeDisabled={busy} />
            <DialogContent>
                <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                    <Alert severity="warning">
                        This removes the project configuration, connectors, chats, and indexed data.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        Type <strong>{projectKey}</strong> to confirm deletion.
                    </Typography>
                    <TextField
                        label="Project Key Confirmation"
                        value={confirmKey}
                        onChange={(e) => setConfirmKey(e.target.value)}
                        autoFocus
                        fullWidth
                        disabled={busy}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button
                    color="error"
                    variant="contained"
                    startIcon={<DeleteForeverRounded />}
                    disabled={busy || !projectKey || confirmKey.trim() !== projectKey}
                    onClick={() => void onDelete()}
                >
                    Delete Project
                </Button>
            </DialogActions>
        </Dialog>
    )
}
