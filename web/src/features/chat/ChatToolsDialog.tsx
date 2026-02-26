"use client"

import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
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
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import type { ToolCatalogItem } from "@/features/chat/types"
import AppDialogTitle from "@/components/AppDialogTitle"

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
    const groupedTools = toolCatalog.reduce<Record<string, ToolCatalogItem[]>>((acc, tool) => {
        const key = String(tool.class_path || tool.class_key || "uncategorized")
        if (!acc[key]) acc[key] = []
        acc[key].push(tool)
        return acc
    }, {})
    const groupKeys = Object.keys(groupedTools).sort((a, b) => a.localeCompare(b))

    const classEnabled = (classTools: ToolCatalogItem[]) => classTools.filter((tool) => toolEnabledSet.has(tool.name)).length

    const toggleClass = (classTools: ToolCatalogItem[]) => {
        const enabledCount = classEnabled(classTools)
        const enableAll = enabledCount !== classTools.length
        for (const tool of classTools) {
            const isEnabled = toolEnabledSet.has(tool.name)
            if (enableAll && !isEnabled) onToggleToolEnabled(tool.name)
            if (!enableAll && isEnabled) onToggleToolEnabled(tool.name)
        }
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <AppDialogTitle
                title="Chat Tool Configuration"
                subtitle={
                    <>
                        Chat: <code>{chatId || "none"}</code>
                    </>
                }
                onClose={onClose}
            />
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
                    <Stack spacing={0.8}>
                        {groupKeys.map((groupKey) => {
                            const tools = groupedTools[groupKey]
                            const enabledCount = classEnabled(tools)
                            const allEnabled = enabledCount === tools.length && tools.length > 0
                            const someEnabled = enabledCount > 0 && enabledCount < tools.length
                            const classHasApproval = tools.some(
                                (tool) => !Boolean(tool.read_only) && (Boolean(tool.require_approval) || Boolean(requireApprovalForWriteTools))
                            )
                            return (
                                <Accordion key={groupKey} disableGutters defaultExpanded>
                                    <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                                        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
                                            <Switch
                                                size="small"
                                                checked={allEnabled}
                                                onChange={() => toggleClass(tools)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                                {groupKey}
                                            </Typography>
                                            <Chip
                                                size="small"
                                                label={`${enabledCount}/${tools.length}${someEnabled ? " partial" : ""}`}
                                                variant="outlined"
                                            />
                                            {classHasApproval ? <Chip size="small" label="Contains write tools" color="warning" variant="outlined" /> : null}
                                        </Stack>
                                    </AccordionSummary>
                                    <AccordionDetails sx={{ pt: 0.5 }}>
                                        <List dense sx={{ py: 0 }}>
                                            {tools.map((tool) => {
                                                const enabled = toolEnabledSet.has(tool.name)
                                                const requiresApproval =
                                                    !Boolean(tool.read_only) &&
                                                    (Boolean(tool.require_approval) || Boolean(requireApprovalForWriteTools))
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
                                        </List>
                                    </AccordionDetails>
                                </Accordion>
                            )
                        })}
                        {!toolCatalog.length && !toolsLoading && (
                            <ListItemButton disabled>
                                <ListItemText primary="No tools found." />
                            </ListItemButton>
                        )}
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button variant="contained" onClick={() => void onSave()} disabled={toolsSaving || !chatId}>
                    {toolsSaving ? "Saving..." : "Save"}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
