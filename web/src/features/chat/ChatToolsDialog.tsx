"use client"

import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Stack,
    Switch,
    Typography,
} from "@mui/material"
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded"
import type { ToolCatalogItem } from "@/features/chat/types"

type ChatToolsDialogProps = {
    open: boolean
    chatId: string | null
    toolsLoading: boolean
    toolsError: string | null
    toolsSaving: boolean
    toolReadOnlyOnly: boolean
    toolDryRun: boolean
    requireApprovalForWriteTools: boolean
    toolCatalog: ToolCatalogItem[]
    toolEnabledSet: Set<string>
    approvedTools: Set<string>
    approvalBusyTool: string | null
    onClose: () => void
    onErrorClose: () => void
    onToggleReadOnlyOnly: (next: boolean) => void
    onToggleDryRun: (next: boolean) => void
    onToggleRequireApprovalForWriteTools: (next: boolean) => void
    onToggleToolEnabled: (toolName: string) => void
    onSetToolApproval: (toolName: string, approve: boolean) => void | Promise<void>
    onSave: () => void | Promise<void>
}

export function ChatToolsDialog({
    open,
    chatId,
    toolsLoading,
    toolsError,
    toolsSaving,
    toolReadOnlyOnly,
    toolDryRun,
    requireApprovalForWriteTools,
    toolCatalog,
    toolEnabledSet,
    approvedTools,
    approvalBusyTool,
    onClose,
    onErrorClose,
    onToggleReadOnlyOnly,
    onToggleDryRun,
    onToggleRequireApprovalForWriteTools,
    onToggleToolEnabled,
    onSetToolApproval,
    onSave,
}: ChatToolsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Stack spacing={0.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Chat Tool Configuration
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Chat: <code>{chatId || "none"}</code>
                    </Typography>
                </Stack>
            </DialogTitle>
            <DialogContent dividers sx={{ pt: 1.2 }}>
                {toolsLoading && (
                    <Box sx={{ py: 2 }}>
                        <CircularProgress size={18} />
                    </Box>
                )}
                {toolsError && (
                    <Box sx={{ pb: 1.2 }}>
                        <Alert severity="error" onClose={onErrorClose}>
                            {toolsError}
                        </Alert>
                    </Box>
                )}
                <Stack spacing={1.2}>
                    <FormControlLabel
                        control={<Switch checked={toolReadOnlyOnly} onChange={(e) => onToggleReadOnlyOnly(e.target.checked)} />}
                        label="Read-only mode (disable all write/mutating tools)"
                    />
                    <FormControlLabel
                        control={<Switch checked={toolDryRun} onChange={(e) => onToggleDryRun(e.target.checked)} />}
                        label="Dry-run mode (simulate write tools without executing them)"
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={requireApprovalForWriteTools}
                                onChange={(e) => onToggleRequireApprovalForWriteTools(e.target.checked)}
                            />
                        }
                        label="Require explicit approval for all write tools"
                    />
                    <Divider />
                    <List dense>
                        {toolCatalog.map((tool) => {
                            const enabled = toolEnabledSet.has(tool.name)
                            const requiresApproval = Boolean(tool.require_approval) && !Boolean(tool.read_only)
                            const isApproved = approvedTools.has(tool.name)
                            return (
                                <ListItemButton
                                    key={tool.name}
                                    onClick={() => onToggleToolEnabled(tool.name)}
                                    sx={{ borderRadius: 1.5, mb: 0.35 }}
                                >
                                    <ListItemIcon sx={{ minWidth: 34 }}>
                                        <Switch
                                            size="small"
                                            checked={enabled}
                                            onChange={() => onToggleToolEnabled(tool.name)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                    {tool.name}
                                                </Typography>
                                                {enabled && <CheckCircleRounded fontSize="inherit" color="success" />}
                                                {tool.origin === "custom" && (
                                                    <Chip size="small" label="Custom" color="secondary" variant="outlined" />
                                                )}
                                                {tool.runtime === "local_typescript" && (
                                                    <Chip size="small" label="Local TS" color="secondary" variant="outlined" />
                                                )}
                                                {requiresApproval && (
                                                    <Chip
                                                        size="small"
                                                        label={isApproved ? "Approved" : "Approval required"}
                                                        color={isApproved ? "success" : "warning"}
                                                        variant={isApproved ? "filled" : "outlined"}
                                                    />
                                                )}
                                                {requiresApproval && (
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={(e) => {
                                                            e.preventDefault()
                                                            e.stopPropagation()
                                                            void onSetToolApproval(tool.name, !isApproved)
                                                        }}
                                                        disabled={approvalBusyTool === tool.name}
                                                    >
                                                        {approvalBusyTool === tool.name
                                                            ? "..."
                                                            : isApproved
                                                                ? "Revoke"
                                                                : "Approve 60m"}
                                                    </Button>
                                                )}
                                            </Stack>
                                        }
                                        secondary={`${tool.description || ""}${tool.read_only ? " · read-only" : " · write-enabled"}${tool.version ? ` · v${tool.version}` : ""}`}
                                    />
                                </ListItemButton>
                            )
                        })}
                        {!toolCatalog.length && !toolsLoading && (
                            <ListItemButton disabled>
                                <ListItemText primary="No tools found." />
                            </ListItemButton>
                        )}
                    </List>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                <Button variant="contained" onClick={() => void onSave()} disabled={toolsSaving || !chatId}>
                    {toolsSaving ? "Saving..." : "Save"}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
