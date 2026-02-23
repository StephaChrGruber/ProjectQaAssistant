"use client"

import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    FormControlLabel,
    Paper,
    Stack,
    Switch,
    Typography,
} from "@mui/material"
import type {
    ConnectorHealthResponse,
    FeatureFlags,
} from "@/features/project-settings/form-model"

type FeatureFlagsCardProps = {
    featureFlags: FeatureFlags
    onChange: (next: FeatureFlags) => void
    onSave: () => Promise<void>
    saving: boolean
    connectorHealth: ConnectorHealthResponse | null
    connectorHealthLoading: boolean
    onRefreshConnectorHealth: () => Promise<void>
}

export default function FeatureFlagsCard(props: FeatureFlagsCardProps) {
    const {
        featureFlags,
        onChange,
        onSave,
        saving,
        connectorHealth,
        connectorHealthLoading,
        onRefreshConnectorHealth,
    } = props

    function toggle(key: keyof FeatureFlags) {
        onChange({
            ...featureFlags,
            [key]: !featureFlags[key],
        })
    }

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
                <Typography variant="h6">Runtime Feature Flags</Typography>
                <Typography variant="body2" color="text.secondary">
                    Control runtime behavior globally for this project.
                </Typography>

                <FormControlLabel
                    control={<Switch checked={featureFlags.enable_audit_events} onChange={() => toggle("enable_audit_events")} />}
                    label="Enable audit events"
                />
                <FormControlLabel
                    control={
                        <Switch checked={featureFlags.enable_connector_health} onChange={() => toggle("enable_connector_health")} />
                    }
                    label="Enable connector health checks"
                />
                <FormControlLabel
                    control={<Switch checked={featureFlags.enable_memory_controls} onChange={() => toggle("enable_memory_controls")} />}
                    label="Enable memory controls"
                />
                <FormControlLabel
                    control={<Switch checked={featureFlags.dry_run_tools_default} onChange={() => toggle("dry_run_tools_default")} />}
                    label="Default tool execution mode: dry-run"
                />
                <FormControlLabel
                    control={
                        <Switch
                            checked={featureFlags.require_approval_for_write_tools}
                            onChange={() => toggle("require_approval_for_write_tools")}
                        />
                    }
                    label="Require explicit approval for write tools"
                />

                <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={onSave} disabled={saving}>
                        {saving ? "Saving..." : "Save Flags"}
                    </Button>
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1">Connector Health</Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={onRefreshConnectorHealth}
                        disabled={connectorHealthLoading}
                    >
                        {connectorHealthLoading ? "Refreshing..." : "Refresh"}
                    </Button>
                </Stack>

                {connectorHealth ? (
                    <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary">
                            {connectorHealth.ok}/{connectorHealth.total} healthy
                        </Typography>
                        {connectorHealth.items.map((row) => (
                            <Box
                                key={row.id}
                                sx={{
                                    border: "1px solid",
                                    borderColor: "divider",
                                    borderRadius: 1,
                                    px: 1.25,
                                    py: 0.9,
                                }}
                            >
                                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Chip
                                            size="small"
                                            color={row.ok ? "success" : "warning"}
                                            label={row.ok ? "OK" : "WARN"}
                                        />
                                        <Typography variant="body2">{row.type}</Typography>
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary">
                                        {row.latency_ms ?? 0} ms
                                    </Typography>
                                </Stack>
                                {row.detail ? (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.4, display: "block" }}>
                                        {row.detail}
                                    </Typography>
                                ) : null}
                            </Box>
                        ))}
                    </Stack>
                ) : (
                    <Alert severity="info">No connector health data loaded yet.</Alert>
                )}
            </Stack>
        </Paper>
    )
}
