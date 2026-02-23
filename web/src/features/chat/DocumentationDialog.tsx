"use client"

import type { ReactNode } from "react"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Stack,
    Typography,
} from "@mui/material"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import CloseRounded from "@mui/icons-material/CloseRounded"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type DocumentationDialogProps = {
    open: boolean
    branch: string
    docsGenerating: boolean
    docsLoading: boolean
    docContentLoading: boolean
    docsError: string | null
    docsNotice: string | null
    docsFilesCount: number
    selectedDocPath: string | null
    selectedDocContent: string
    docTreeNodes: ReactNode
    onClose: () => void
    onRegenerate: () => void | Promise<void>
    onDocsErrorClose: () => void
    onDocsNoticeClose: () => void
}

export function DocumentationDialog({
    open,
    branch,
    docsGenerating,
    docsLoading,
    docContentLoading,
    docsError,
    docsNotice,
    docsFilesCount,
    selectedDocPath,
    selectedDocContent,
    docTreeNodes,
    onClose,
    onRegenerate,
    onDocsErrorClose,
    onDocsNoticeClose,
}: DocumentationDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Stack spacing={0.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Project Documentation
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Branch: {branch} · Source folder: <code>documentation/</code>
                    </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<AutoFixHighRounded />}
                        onClick={() => void onRegenerate()}
                        disabled={docsGenerating}
                    >
                        {docsGenerating ? "Generating..." : "Regenerate"}
                    </Button>
                    <Button size="small" variant="text" startIcon={<CloseRounded />} onClick={onClose}>
                        Close
                    </Button>
                </Stack>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
                {(docsLoading || docContentLoading) && (
                    <Box sx={{ px: 2, py: 1 }}>
                        <CircularProgress size={18} />
                    </Box>
                )}
                {docsError && (
                    <Box sx={{ p: 1.5 }}>
                        <Alert severity="error" onClose={onDocsErrorClose}>
                            {docsError}
                        </Alert>
                    </Box>
                )}
                {docsNotice && open && (
                    <Box sx={{ p: 1.5 }}>
                        <Alert severity="success" onClose={onDocsNoticeClose}>
                            {docsNotice}
                        </Alert>
                    </Box>
                )}

                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px 1fr" }, minHeight: 500 }}>
                    <Box sx={{ borderRight: { md: "1px solid" }, borderColor: "divider", bgcolor: "background.default" }}>
                        <List dense sx={{ maxHeight: 560, overflowY: "auto" }}>
                            {docTreeNodes}
                            {!docsFilesCount && !docsLoading && (
                                <ListItemButton disabled>
                                    <ListItemText primary="No documentation files found." />
                                </ListItemButton>
                            )}
                        </List>
                    </Box>

                    <Box sx={{ p: { xs: 1.5, md: 2.2 }, overflowY: "auto", maxHeight: 560 }}>
                        {selectedDocPath ? (
                            <Stack spacing={1.4}>
                                <Typography variant="subtitle2" color="text.secondary">
                                    {selectedDocPath}
                                </Typography>
                                <Divider />
                                <Box
                                    sx={{
                                        "& h1, & h2, & h3": { mt: 2, mb: 1 },
                                        "& p, & li": { fontSize: "0.93rem" },
                                        "& code": {
                                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                            bgcolor: "action.hover",
                                            px: 0.5,
                                            borderRadius: 0.6,
                                        },
                                        "& pre code": {
                                            display: "block",
                                            p: 1.2,
                                            overflowX: "auto",
                                        },
                                    }}
                                >
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {selectedDocContent || "_No content._"}
                                    </ReactMarkdown>
                                </Box>
                            </Stack>
                        ) : (
                            <Typography variant="body2" color="text.secondary">
                                Generate documentation or select a file to preview.
                            </Typography>
                        )}
                    </Box>
                </Box>
            </DialogContent>
        </Dialog>
    )
}
