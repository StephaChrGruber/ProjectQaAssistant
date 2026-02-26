"use client"

import ChatBubbleOutlineRounded from "@mui/icons-material/ChatBubbleOutlineRounded"
import SettingsRounded from "@mui/icons-material/SettingsRounded"
import AdminPanelSettingsRounded from "@mui/icons-material/AdminPanelSettingsRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import AutoModeRounded from "@mui/icons-material/AutoModeRounded"
import NotificationsRounded from "@mui/icons-material/NotificationsRounded"
import AddRounded from "@mui/icons-material/AddRounded"
import MenuRounded from "@mui/icons-material/MenuRounded"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import {
    AppBar,
    Badge,
    Box,
    Button,
    Chip,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Stack,
    Toolbar,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { requestOpenGlobalNotifications } from "@/features/notifications/events"
import { backendJson } from "@/lib/backend"

export type DrawerUser = {
    displayName?: string
    email?: string
    isGlobalAdmin?: boolean
}

export type DrawerChat = {
    chat_id: string
    title?: string
    branch?: string
    project_id?: string
    updated_at?: string
    created_at?: string
}

export type DrawerChatGroup = {
    projectId: string
    projectLabel: string
    chats: DrawerChat[]
}

type Props = {
    projectId: string
    projectLabel: string
    branch: string
    chatGroups: DrawerChatGroup[]
    selectedChatId: string | null
    onSelectChat: (chat: DrawerChat, projectId: string) => void
    onNewChat: () => void
    onOpenSettings?: () => void
    user?: DrawerUser | null
    loadingChats?: boolean
    activeSection?: "chat" | "settings" | "automations"
    children: React.ReactNode
}

const DRAWER_WIDTH = 320

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
    const looksLikeId = /^[a-f0-9]{24}$/i.test(title) || /^[-\w]+::[-\w]+::/.test(title)
    if (title && title !== chat.chat_id && !title.includes("::") && !looksLikeId) return title
    const ts = formatTime(chat.updated_at || chat.created_at)
    if (ts) return `Conversation · ${ts}`
    return "New Conversation"
}

export function ProjectDrawerLayout(props: Props) {
    const {
        projectId,
        projectLabel,
        branch,
        chatGroups,
        selectedChatId,
        onSelectChat,
        onNewChat,
        onOpenSettings,
        user,
        loadingChats,
        activeSection = "chat",
        children,
    } = props

    const pathname = usePathname()
    const theme = useTheme()
    const desktop = useMediaQuery(theme.breakpoints.up("md"))
    const [mobileOpen, setMobileOpen] = useState(false)
    const [activeNotificationCount, setActiveNotificationCount] = useState(0)
    const showDrawer = useMemo(
        () => pathname.includes("/settings") || pathname.startsWith("/admin"),
        [pathname]
    )

    const userLabel = useMemo(() => user?.displayName || user?.email || "Developer", [user])
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

    const normalizedGroups = useMemo(() => {
        return (chatGroups || []).map((group) => {
            const out: DrawerChat[] = []
            const seen = new Set<string>()
            for (const chat of group.chats || []) {
                const id = (chat?.chat_id || "").trim()
                if (!id || seen.has(id)) continue
                seen.add(id)
                out.push(chat)
            }
            return {
                projectId: group.projectId,
                projectLabel: group.projectLabel,
                chats: out,
            }
        })
    }, [chatGroups])

    const totalConversations = useMemo(
        () => normalizedGroups.reduce((acc, group) => acc + (group.chats?.length || 0), 0),
        [normalizedGroups]
    )

    useEffect(() => {
        setExpandedGroups((prev) => {
            const next: Record<string, boolean> = {}
            for (const group of normalizedGroups) {
                const hasSelected = !!group.chats.find((c) => c.chat_id === selectedChatId)
                next[group.projectId] = prev[group.projectId] ?? (hasSelected || group.projectId === projectId)
            }
            return next
        })
    }, [normalizedGroups, projectId, selectedChatId])

    const toggleGroup = (groupProjectId: string) => {
        setExpandedGroups((prev) => ({ ...prev, [groupProjectId]: !prev[groupProjectId] }))
    }

    const fallbackChatLabel = useMemo(() => {
        const title = (projectLabel || "").trim()
        if (!title) return "New Conversation"
        return `${title} Conversation`
    }, [projectLabel])

    useEffect(() => {
        let cancelled = false

        async function loadNotificationsCount() {
            try {
                const res = await backendJson<{ active_count?: number }>(
                    "/api/notifications?include_dismissed=0&limit=1"
                )
                if (!cancelled) {
                    setActiveNotificationCount(Math.max(0, Number(res?.active_count || 0)))
                }
            } catch {
                if (!cancelled) {
                    setActiveNotificationCount(0)
                }
            }
        }

        void loadNotificationsCount()
        const timer = window.setInterval(() => {
            void loadNotificationsCount()
        }, 10_000)

        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [])

    const renderChatItem = (chat: DrawerChat, groupProjectId: string) => {
        const selected = chat.chat_id === selectedChatId
        const primary = chatLabel(chat) || fallbackChatLabel
        return (
                <ListItemButton
                key={`${groupProjectId}::${chat.chat_id}`}
                selected={selected}
                onClick={() => {
                    onSelectChat(chat, groupProjectId)
                    if (!desktop) setMobileOpen(false)
                }}
                sx={{
                    mb: 0.35,
                    borderRadius: 1.8,
                    alignItems: "flex-start",
                    border: "1px solid",
                    borderColor: selected ? "rgba(34,211,238,0.38)" : "rgba(148,163,184,0.15)",
                    bgcolor: selected ? "rgba(14,116,144,0.16)" : "rgba(15,23,42,0.28)",
                    ml: 0.35,
                }}
            >
                <ListItemIcon sx={{ minWidth: 34, mt: 0.1 }}>
                    <ChatBubbleOutlineRounded fontSize="small" />
                </ListItemIcon>
                <ListItemText
                    primary={primary}
                    secondary={`${chat.branch || branch}${chat.updated_at ? ` · ${formatTime(chat.updated_at)}` : ""}`}
                    primaryTypographyProps={{
                        noWrap: true,
                        fontWeight: selected ? 600 : 500,
                        fontSize: 13,
                    }}
                    secondaryTypographyProps={{
                        noWrap: true,
                        fontSize: 11,
                    }}
                />
            </ListItemButton>
        )
    }

    useEffect(() => {
        setMobileOpen(false)
    }, [pathname])

    useEffect(() => {
        if (!showDrawer) {
            setMobileOpen(false)
        }
    }, [showDrawer])

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
            <Box sx={{ px: 1.6, py: 1.1 }}>
                <Button
                    fullWidth
                    variant="contained"
                    size="small"
                    startIcon={<AddRounded />}
                    onClick={() => {
                        onNewChat()
                        if (!desktop) setMobileOpen(false)
                    }}
                >
                    New Chat
                </Button>
            </Box>

            <Divider />

            <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: 1, py: 0.9 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.7, mb: 0.2 }}>
                    <Typography
                        variant="overline"
                        sx={{ color: "text.secondary", letterSpacing: "0.11em" }}
                    >
                        Conversations
                    </Typography>
                    <Chip
                        size="small"
                        label={totalConversations}
                        sx={{
                            height: 20,
                            fontSize: 11,
                            bgcolor: "rgba(148,163,184,0.14)",
                            color: "text.secondary",
                        }}
                    />
                </Stack>

                <List dense sx={{ pt: 0.25 }}>
                    {loadingChats && (
                        <ListItemButton disabled sx={{ borderRadius: 2, py: 1 }}>
                            <ListItemText primary="Loading chats..." />
                        </ListItemButton>
                    )}

                    {!loadingChats && totalConversations === 0 && (
                        <ListItemButton disabled sx={{ borderRadius: 2, py: 1 }}>
                            <ListItemText primary="No conversations yet" />
                        </ListItemButton>
                    )}

                    {normalizedGroups.map((group) => {
                        const expanded = expandedGroups[group.projectId] ?? true
                        const inThisProject = group.projectId === projectId
                        return (
                            <Box key={group.projectId} sx={{ mb: 0.6 }}>
                                <ListItemButton
                                    onClick={() => toggleGroup(group.projectId)}
                                    sx={{
                                        borderRadius: 1.7,
                                        mb: 0.25,
                                        border: "1px solid",
                                        borderColor: inThisProject ? "rgba(34,211,238,0.3)" : "rgba(148,163,184,0.16)",
                                        bgcolor: inThisProject ? "rgba(8,47,73,0.28)" : "rgba(15,23,42,0.2)",
                                    }}
                                >
                                    {expanded ? <ExpandMoreRounded fontSize="small" /> : <ChevronRightRounded fontSize="small" />}
                                    <ListItemText
                                        primary={group.projectLabel}
                                        secondary={inThisProject ? "Current project" : undefined}
                                        primaryTypographyProps={{ noWrap: true, fontWeight: 650, fontSize: 12.8 }}
                                        secondaryTypographyProps={{ noWrap: true, fontSize: 10.8 }}
                                        sx={{ ml: 0.6 }}
                                    />
                                    <Chip
                                        size="small"
                                        label={group.chats.length}
                                        sx={{
                                            height: 20,
                                            fontSize: 11,
                                            bgcolor: "rgba(148,163,184,0.14)",
                                            color: "text.secondary",
                                        }}
                                    />
                                </ListItemButton>
                                {expanded && (
                                    <Box sx={{ pl: 0.45 }}>
                                        {group.chats.length ? (
                                            group.chats.map((chat) => renderChatItem(chat, group.projectId))
                                        ) : (
                                            <ListItemButton disabled sx={{ borderRadius: 1.7, py: 0.65, ml: 0.35 }}>
                                                <ListItemText primary="No conversations" />
                                            </ListItemButton>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        )
                    })}
                </List>
            </Box>

            <Divider />

            <Box sx={{ px: 1.15, py: 1 }}>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ px: 1, display: "block", pb: 1 }}>
                    {userLabel}
                </Typography>

                <List dense>
                    {onOpenSettings ? (
                        <ListItemButton
                            onClick={() => {
                                onOpenSettings()
                                if (!desktop) setMobileOpen(false)
                            }}
                            selected={activeSection === "settings"}
                            sx={{ borderRadius: 1.7 }}
                        >
                            <ListItemIcon sx={{ minWidth: 34 }}>
                                <SettingsRounded fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary="Settings" />
                        </ListItemButton>
                    ) : (
                        <ListItemButton
                            component={Link}
                            href={`/projects/${projectId}/settings`}
                            selected={activeSection === "settings"}
                            sx={{ borderRadius: 1.7 }}
                        >
                            <ListItemIcon sx={{ minWidth: 34 }}>
                                <SettingsRounded fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary="Settings" />
                        </ListItemButton>
                    )}

                    <ListItemButton
                        component={Link}
                        href={`/projects/${projectId}/automations`}
                        selected={activeSection === "automations"}
                        sx={{ borderRadius: 1.7 }}
                    >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                            <AutoModeRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Automations" />
                    </ListItemButton>

                    <ListItemButton
                        onClick={() => requestOpenGlobalNotifications()}
                        sx={{ borderRadius: 1.7 }}
                    >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                            <Badge
                                color="error"
                                badgeContent={activeNotificationCount}
                                max={99}
                            >
                                <NotificationsRounded fontSize="small" />
                            </Badge>
                        </ListItemIcon>
                        <ListItemText primary="Notifications" />
                    </ListItemButton>

                    {user?.isGlobalAdmin && (
                        <ListItemButton component={Link} href="/admin" sx={{ borderRadius: 1.7 }}>
                            <ListItemIcon sx={{ minWidth: 34 }}>
                                <AdminPanelSettingsRounded fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary="Admin" />
                        </ListItemButton>
                    )}

                    <ListItemButton component={Link} href="/projects" sx={{ borderRadius: 1.7 }}>
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

            {showDrawer && (
                <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
                    <Drawer
                        variant={desktop ? "permanent" : "temporary"}
                        open={desktop ? true : mobileOpen}
                        onClose={() => setMobileOpen(false)}
                        ModalProps={{ keepMounted: true }}
                        sx={{
                            display: "block",
                            "& .MuiDrawer-paper": {
                                width: { xs: "min(90vw, 340px)", md: DRAWER_WIDTH },
                                boxSizing: "border-box",
                                borderRightColor: "rgba(148,163,184,0.28)",
                            },
                        }}
                    >
                        {drawerContent}
                    </Drawer>
                </Box>
            )}

            <Box sx={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden" }}>
                {showDrawer && !desktop && (
                    <AppBar
                        position="sticky"
                        color="transparent"
                        elevation={0}
                        sx={{
                            borderBottom: "1px solid rgba(148,163,184,0.2)",
                            backgroundColor: "rgba(7, 11, 22, 0.72)",
                        }}
                    >
                        <Toolbar sx={{ minHeight: 52 }}>
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
                                <Typography noWrap variant="subtitle2" sx={{ fontWeight: 700, fontSize: 13.5 }}>
                                    {projectLabel}
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
