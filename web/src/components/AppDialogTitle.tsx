"use client"

import type { ReactNode } from "react"
import { DialogTitle, IconButton, Stack, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"

type AppDialogTitleProps = {
    title: ReactNode
    subtitle?: ReactNode
    onClose?: () => void
    closeDisabled?: boolean
    rightActions?: ReactNode
}

export default function AppDialogTitle({
    title,
    subtitle,
    onClose,
    closeDisabled = false,
    rightActions,
}: AppDialogTitleProps) {
    return (
        <DialogTitle sx={{ py: 0.9 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                        {title}
                    </Typography>
                    {subtitle ? (
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25 }}>
                            {subtitle}
                        </Typography>
                    ) : null}
                </Stack>
                <Stack direction="row" spacing={0.6} alignItems="center">
                    {rightActions}
                    {onClose ? (
                        <IconButton size="small" onClick={onClose} disabled={closeDisabled} aria-label="close dialog">
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    ) : null}
                </Stack>
            </Stack>
        </DialogTitle>
    )
}

