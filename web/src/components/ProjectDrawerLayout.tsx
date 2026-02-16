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

const DRAWER_WIDTH = 380

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
            <Box sx={{ px: 2.5, py: 2.5 }}>
                <Typography
                    variant="overline"
                    sx={{
                        color: "primary.light",
                        letterSpacing: "0.12em",
                        fontWeight: 700,
                    }}
                >
                    Project QA
                </Typography>
                <Typography
                    variant="h6"
                    noWrap
                    sx={{ mt: 1, fontWeight: 700, lineHeight: 1.25 }}
                >
                    {projectLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                    {projectId}
                </Typography>
            </Box>

            <Divider />

            <Box sx={{ px: 2.5, py: 2 }}>
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

            <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: 1.25, py: 1.25 }}>
                <Typography
                    variant="overline"
                    sx={{ px: 1.25, color: "text.secondary", letterSpacing: "0.11em" }}
                >
                    Conversations
                </Typography>

                <List dense sx={{ pt: 0.5 }}>
                    {loadingChats && (
                        <ListItemButton disabled sx={{ borderRadius: 2 }}>
                            <ListItemText primary="Loading chats..." />
                        </ListItemButton>
                    )}

                    {!loadingChats && chats.length === 0 && (
                        <ListItemButton disabled sx={{ borderRadius: 2 }}>
                            <ListItemText primary="No chats for this branch" />
                        </ListItemButton>
                    )}

                    {chats.map((chat) => {
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
                                    borderRadius: 2,
                                    alignItems: "flex-start",
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
                                        fontSize: 11,
                                    }}
                                />
                            </ListItemButton>
                        )
                    })}
                </List>
            </Box>

            <Divider />

            <Box sx={{ px: 2, py: 1.5 }}>
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
                    backgroundColor: "#05050a",
                }}
            />
            <Box
                sx={{
                    position: "fixed",
                    inset: 0,
                    zIndex: -10,
                    background:
                        "radial-gradient(1000px 500px at 5% 0%, rgba(0,193,255,0.22), transparent 60%), radial-gradient(800px 420px at 95% 4%, rgba(0,255,166,0.14), transparent 55%), linear-gradient(180deg, #090e1a 0%, #05050a 100%)",
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
                            backgroundColor: "rgba(15, 20, 34, 0.88)",
                            borderRightColor: "rgba(255,255,255,0.14)",
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
                            borderBottom: "1px solid rgba(255,255,255,0.1)",
                            backgroundColor: "rgba(10, 12, 22, 0.68)",
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
