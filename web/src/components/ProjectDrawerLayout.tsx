"use client"

import ChatBubbleOutlineRounded from "@mui/icons-material/ChatBubbleOutlineRounded"
import SettingsRounded from "@mui/icons-material/SettingsRounded"
import AdminPanelSettingsRounded from "@mui/icons-material/AdminPanelSettingsRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import AddRounded from "@mui/icons-material/AddRounded"
import MenuRounded from "@mui/icons-material/MenuRounded"
import {
    AppBar,
    Box,
    Button,
    Chip,
    Divider,
    Drawer,
    FormControl,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    MenuItem,
    Select,
    Stack,
    Toolbar,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

export type DrawerUser = {
    displayName?: string
    email?: string
    isGlobalAdmin?: boolean
}

export type DrawerChat = {
    chat_id: string
    title?: string
    branch?: string
    updated_at?: string
    created_at?: string
}

type Props = {
    projectId: string
    projectLabel: string
    branch: string
    branches: string[]
    onBranchChange: (branch: string) => void
    chats: DrawerChat[]
    selectedChatId: string | null
    onSelectChat: (chat: DrawerChat) => void
    onNewChat: () => void
    user?: DrawerUser | null
    loadingChats?: boolean
    activeSection?: "chat" | "settings"
    children: React.ReactNode
}

const DRAWER_WIDTH = 392

function formatTime(iso?: string): string {
    if (!iso) return ""
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function chatLabel(chat: DrawerChat): string {
    const title = (chat.title || "").trim()
    if (!title) return "New Conversation"
    return title
}

export function ProjectDrawerLayout(props: Props) {
    const {
        projectId,
        projectLabel,
        branch,
        branches,
        onBranchChange,
        chats,
        selectedChatId,
        onSelectChat,
        onNewChat,
        user,
        loadingChats,
        activeSection = "chat",
        children,
    } = props

    const pathname = usePathname()
    const theme = useTheme()
    const desktop = useMediaQuery(theme.breakpoints.up("md"))
    const [mobileOpen, setMobileOpen] = useState(false)

    const userLabel = useMemo(() => user?.displayName || user?.email || "Developer", [user])
    const uniqueChats = useMemo(() => {
        const out: DrawerChat[] = []
        const seen = new Set<string>()
        for (const chat of chats || []) {
            const id = (chat?.chat_id || "").trim()
            if (!id || seen.has(id)) continue
            seen.add(id)
            out.push(chat)
        }
        return out
    }, [chats])

    useEffect(() => {
        setMobileOpen(false)
    }, [pathname])

    useEffect(() => {
        if (!mobileOpen || desktop) return
        const previous = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = previous
        }
    }, [mobileOpen, desktop])

    const drawerContent = (
        <Box sx={{ display: "flex", height: "100%", flexDirection: "column" }}>
            <Box sx={{ px: 2.25, pt: 2.1, pb: 1.8 }}>
                <Box
                    sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 2,
                        p: 1.6,
                        background: "linear-gradient(160deg, rgba(15,23,42,0.86), rgba(15,23,42,0.42))",
                    }}
                >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography
                            variant="overline"
                            sx={{
                                color: "secondary.light",
                                letterSpacing: "0.13em",
                                fontWeight: 700,
                                lineHeight: 1,
                            }}
                        >
                            Project QA
                        </Typography>
                        <Chip
                            size="small"
                            label={branch || "branch"}
                            variant="outlined"
                            sx={{
                                height: 22,
                                fontSize: 11,
                                color: "secondary.light",
                                borderColor: "rgba(34,211,238,0.35)",
                                bgcolor: "rgba(8,47,73,0.26)",
                            }}
                        />
                    </Stack>

                    <Typography
                        variant="h6"
                        noWrap
                        sx={{ mt: 1, fontWeight: 700, lineHeight: 1.2 }}
                    >
                        {projectLabel}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.15 }}>
                        {projectId}
                    </Typography>
                </Box>
            </Box>

            <Divider />

            <Box sx={{ px: 2.25, py: 1.8 }}>
                <FormControl fullWidth size="small">
                    <InputLabel id="branch-select-label">Branch</InputLabel>
                    <Select
                        labelId="branch-select-label"
                        label="Branch"
                        value={branch}
                        onChange={(event) => {
                            onBranchChange(event.target.value)
                            if (!desktop) setMobileOpen(false)
                        }}
                    >
                        {branches.map((item) => (
                            <MenuItem key={item} value={item}>
                                {item}
                            </MenuItem>
                        ))}
                        {branches.length === 0 && <MenuItem value={branch}>{branch}</MenuItem>}
                    </Select>
                </FormControl>

                <Button
                    fullWidth
                    variant="contained"
                    startIcon={<AddRounded />}
                    onClick={() => {
                        onNewChat()
                        if (!desktop) setMobileOpen(false)
                    }}
                    sx={{ mt: 1.5 }}
                >
                    New Chat
                </Button>
            </Box>

            <Divider />

            <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: 1.4, py: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.9, mb: 0.4 }}>
                    <Typography
                        variant="overline"
                        sx={{ color: "text.secondary", letterSpacing: "0.11em" }}
                    >
                        Conversations
                    </Typography>
                    <Chip
                        size="small"
                        label={uniqueChats.length}
                        sx={{
                            height: 20,
                            fontSize: 11,
                            bgcolor: "rgba(148,163,184,0.14)",
                            color: "text.secondary",
                        }}
                    />
                </Stack>

                <List dense sx={{ pt: 0.5 }}>
                    {loadingChats && (
                        <ListItemButton disabled sx={{ borderRadius: 2, py: 1 }}>
                            <ListItemText primary="Loading chats..." />
                        </ListItemButton>
                    )}

                    {!loadingChats && uniqueChats.length === 0 && (
                        <ListItemButton disabled sx={{ borderRadius: 2, py: 1 }}>
                            <ListItemText primary="No chats for this branch" />
                        </ListItemButton>
                    )}

                    {uniqueChats.map((chat) => {
                        const selected = chat.chat_id === selectedChatId
                        return (
                            <ListItemButton
                                key={chat.chat_id}
                                selected={selected}
                                onClick={() => {
                                    onSelectChat(chat)
                                    if (!desktop) setMobileOpen(false)
                                }}
                                sx={{
                                    mb: 0.5,
                                    borderRadius: 2.2,
                                    alignItems: "flex-start",
                                    border: "1px solid",
                                    borderColor: selected ? "rgba(34,211,238,0.38)" : "rgba(148,163,184,0.15)",
                                    bgcolor: selected ? "rgba(14,116,144,0.16)" : "rgba(15,23,42,0.28)",
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 34, mt: 0.1 }}>
                                    <ChatBubbleOutlineRounded fontSize="small" />
                                </ListItemIcon>
                                <ListItemText
                                    primary={chatLabel(chat)}
                                    secondary={`${chat.branch || branch}${chat.updated_at ? ` · ${formatTime(chat.updated_at)}` : ""}`}
                                    primaryTypographyProps={{
                                        noWrap: true,
                                        fontWeight: selected ? 600 : 500,
                                        fontSize: 14,
                                    }}
                                    secondaryTypographyProps={{
                                        noWrap: true,
                                        fontSize: 11.5,
                                    }}
                                />
                            </ListItemButton>
                        )
                    })}
                </List>
            </Box>

            <Divider />

            <Box sx={{ px: 1.65, py: 1.35 }}>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ px: 1, display: "block", pb: 1 }}>
                    {userLabel}
                </Typography>

                <List dense>
                    <ListItemButton
                        component={Link}
                        href={`/projects/${projectId}/settings`}
                        selected={activeSection === "settings"}
                        sx={{ borderRadius: 2 }}
                    >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                            <SettingsRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Settings" />
                    </ListItemButton>

                    {user?.isGlobalAdmin && (
                        <ListItemButton component={Link} href="/admin" sx={{ borderRadius: 2 }}>
                            <ListItemIcon sx={{ minWidth: 34 }}>
                                <AdminPanelSettingsRounded fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary="Admin" />
                        </ListItemButton>
                    )}

                    <ListItemButton component={Link} href="/projects" sx={{ borderRadius: 2 }}>
                        <ListItemIcon sx={{ minWidth: 34 }}>
                            <FolderRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Projects" />
                    </ListItemButton>
                </List>
            </Box>
        </Box>
    )

    return (
        <Box sx={{ display: "flex", height: "100dvh", minHeight: "100vh", overflow: "hidden" }}>
            <Box
                sx={{
                    position: "fixed",
                    inset: 0,
                    zIndex: -20,
                    backgroundColor: "background.default",
                }}
            />
            <Box
                sx={{
                    position: "fixed",
                    inset: 0,
                    zIndex: -10,
                    background:
                        "radial-gradient(1100px 640px at 0% 0%, rgba(34,211,238,0.14), transparent 60%), radial-gradient(900px 420px at 100% 0%, rgba(52,211,153,0.12), transparent 58%), linear-gradient(180deg, rgba(8,13,26,0.7) 0%, rgba(5,7,15,0.92) 100%)",
                }}
            />

            <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
                <Drawer
                    variant={desktop ? "permanent" : "temporary"}
                    open={desktop ? true : mobileOpen}
                    onClose={() => setMobileOpen(false)}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        display: "block",
                        "& .MuiDrawer-paper": {
                            width: { xs: "min(92vw, 380px)", md: DRAWER_WIDTH },
                            boxSizing: "border-box",
                            borderRightColor: "rgba(148,163,184,0.28)",
                        },
                    }}
                >
                    {drawerContent}
                </Drawer>
            </Box>

            <Box sx={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden" }}>
                {!desktop && (
                    <AppBar
                        position="sticky"
                        color="transparent"
                        elevation={0}
                        sx={{
                            borderBottom: "1px solid rgba(148,163,184,0.2)",
                            backgroundColor: "rgba(7, 11, 22, 0.72)",
                        }}
                    >
                        <Toolbar sx={{ minHeight: 62 }}>
                            <IconButton
                                color="inherit"
                                edge="start"
                                onClick={() => setMobileOpen(true)}
                                aria-label="open navigation"
                                sx={{ mr: 1 }}
                            >
                                <MenuRounded />
                            </IconButton>

                            <Stack sx={{ minWidth: 0, ml: "auto", textAlign: "right" }}>
                                <Typography noWrap variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {projectLabel}
                                </Typography>
                                <Typography noWrap variant="caption" color="text.secondary">
                                    {branch}
                                </Typography>
                            </Stack>
                        </Toolbar>
                    </AppBar>
                )}

                {children}
            </Box>
        </Box>
    )
}
