"use client"

import { CssBaseline, ThemeProvider, createTheme, responsiveFontSizes } from "@mui/material"
import { alpha } from "@mui/material/styles"
import type { Theme } from "@mui/material/styles"
import { deepmerge } from "@mui/utils"
import { ReactNode, useMemo } from "react"

type Props = {
    children: ReactNode
}

const baseTheme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#2563eb",
            light: "#60a5fa",
            dark: "#1d4ed8",
        },
        secondary: {
            main: "#0ea5a5",
            light: "#5eead4",
            dark: "#0f766e",
        },
        background: {
            default: "#f3f7ff",
            paper: "rgba(255, 255, 255, 0.82)",
        },
        divider: "rgba(15, 23, 42, 0.12)",
        text: {
            primary: "#0f172a",
            secondary: "#475569",
        },
    },
    shape: {
        borderRadius: 14,
    },
    typography: {
        fontFamily: [
            "Space Grotesk",
            "Sora",
            "Avenir Next",
            "Segoe UI",
            "sans-serif",
        ].join(","),
        fontSize: 13,
        h4: {
            fontWeight: 700,
            fontSize: "1.35rem",
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
        },
        h5: {
            fontWeight: 700,
            fontSize: "1.14rem",
            letterSpacing: "-0.01em",
            lineHeight: 1.22,
        },
        button: {
            textTransform: "none",
            fontWeight: 600,
            letterSpacing: "0.01em",
            fontSize: "0.82rem",
        },
        h6: {
            fontWeight: 700,
            fontSize: "0.98rem",
            letterSpacing: "-0.01em",
            lineHeight: 1.25,
        },
        subtitle1: {
            fontSize: "0.9rem",
            lineHeight: 1.35,
        },
        subtitle2: {
            fontSize: "0.82rem",
            lineHeight: 1.35,
        },
        body1: {
            fontSize: "0.89rem",
            lineHeight: 1.45,
        },
        body2: {
            fontSize: "0.82rem",
            lineHeight: 1.45,
        },
        caption: {
            fontSize: "0.74rem",
            lineHeight: 1.35,
        },
    },
    shadows: [
        "none",
        "0 1px 2px rgba(15,23,42,0.05)",
        "0 8px 20px rgba(15,23,42,0.08)",
        "0 12px 28px rgba(15,23,42,0.1)",
        "0 18px 34px rgba(15,23,42,0.12)",
        "0 24px 42px rgba(15,23,42,0.12)",
        "0 30px 46px rgba(15,23,42,0.12)",
        "0 36px 52px rgba(15,23,42,0.12)",
        "0 40px 58px rgba(15,23,42,0.13)",
        "0 42px 62px rgba(15,23,42,0.13)",
        "0 44px 64px rgba(15,23,42,0.14)",
        "0 46px 66px rgba(15,23,42,0.14)",
        "0 48px 68px rgba(15,23,42,0.15)",
        "0 50px 70px rgba(15,23,42,0.15)",
        "0 52px 72px rgba(15,23,42,0.15)",
        "0 54px 74px rgba(15,23,42,0.16)",
        "0 56px 76px rgba(15,23,42,0.16)",
        "0 58px 78px rgba(15,23,42,0.16)",
        "0 60px 80px rgba(15,23,42,0.16)",
        "0 62px 82px rgba(15,23,42,0.17)",
        "0 64px 84px rgba(15,23,42,0.17)",
        "0 66px 86px rgba(15,23,42,0.17)",
        "0 68px 88px rgba(15,23,42,0.18)",
        "0 70px 90px rgba(15,23,42,0.18)",
        "0 72px 92px rgba(15,23,42,0.18)",
    ],
})

export function MuiThemeProvider({ children }: Props) {
    const theme = useMemo(() => {
        const merged = createTheme(
            deepmerge(baseTheme, {
                components: {
                    MuiCssBaseline: {
                        styleOverrides: (t: Theme) => ({
                            body: {
                                background:
                                    "radial-gradient(1300px 720px at -8% -8%, rgba(96,165,250,0.22), transparent 58%), radial-gradient(1000px 620px at 108% -10%, rgba(20,184,166,0.16), transparent 60%), linear-gradient(180deg, #f8fbff 0%, #eef4ff 70%)",
                            },
                            "::selection": {
                                backgroundColor: alpha(t.palette.primary.main, 0.35),
                            },
                        }),
                    },
                    MuiButton: {
                        styleOverrides: {
                            root: {
                                borderRadius: 10,
                                minHeight: 34,
                                paddingTop: 6,
                                paddingBottom: 6,
                                paddingLeft: 12,
                                paddingRight: 12,
                                boxShadow: "none",
                            },
                            contained: {
                                background: "linear-gradient(135deg, #60a5fa 0%, #14b8a6 100%)",
                                color: "#0f172a",
                                fontWeight: 700,
                            },
                            sizeSmall: {
                                minHeight: 30,
                                paddingTop: 4,
                                paddingBottom: 4,
                                paddingLeft: 10,
                                paddingRight: 10,
                            },
                        },
                    },
                    MuiCard: {
                        styleOverrides: {
                            root: {
                                borderColor: "rgba(148,163,184,0.28)",
                            },
                        },
                    },
                    MuiTextField: {
                        defaultProps: {
                            size: "small",
                        },
                    },
                    MuiOutlinedInput: {
                        styleOverrides: {
                            root: {
                                borderRadius: 10,
                                backgroundColor: "rgba(255,255,255,0.72)",
                                "& .MuiOutlinedInput-notchedOutline": {
                                    borderColor: "rgba(15,23,42,0.18)",
                                },
                                "&:hover .MuiOutlinedInput-notchedOutline": {
                                    borderColor: "rgba(15,23,42,0.3)",
                                },
                            },
                            input: {
                                paddingTop: 9,
                                paddingBottom: 9,
                                fontSize: "0.86rem",
                            },
                        },
                    },
                    MuiCardContent: {
                        styleOverrides: {
                            root: {
                                padding: 12,
                                "&:last-child": {
                                    paddingBottom: 12,
                                },
                            },
                        },
                    },
                    MuiDrawer: {
                        styleOverrides: {
                            paper: {
                                backdropFilter: "blur(18px)",
                                borderColor: "rgba(15,23,42,0.14)",
                                backgroundColor: "rgba(255,255,255,0.86)",
                                backgroundImage: "none",
                            },
                        },
                    },
                    MuiAppBar: {
                        styleOverrides: {
                            root: {
                                backdropFilter: "blur(18px)",
                            },
                        },
                    },
                    MuiPaper: {
                        styleOverrides: {
                            root: {
                                backgroundImage: "none",
                                borderColor: "rgba(148,163,184,0.24)",
                            },
                        },
                    },
                    MuiListItemButton: {
                        styleOverrides: {
                            root: {
                                borderRadius: 10,
                                paddingTop: 6,
                                paddingBottom: 6,
                                transition: "background-color 120ms ease, transform 120ms ease",
                                "&.Mui-selected": {
                                    backgroundColor: "rgba(37,99,235,0.1)",
                                    border: "1px solid rgba(37,99,235,0.35)",
                                },
                                "&:hover": {
                                    transform: "translateY(-1px)",
                                },
                            },
                        },
                    },
                    MuiChip: {
                        styleOverrides: {
                            root: {
                                borderRadius: 9,
                                height: 22,
                                fontSize: "0.7rem",
                            },
                        },
                    },
                    MuiMenuItem: {
                        styleOverrides: {
                            root: {
                                minHeight: 34,
                                fontSize: "0.84rem",
                            },
                        },
                    },
                    MuiDialogTitle: {
                        styleOverrides: {
                            root: {
                                paddingTop: 10,
                                paddingBottom: 8,
                                paddingLeft: 14,
                                paddingRight: 14,
                            },
                        },
                    },
                    MuiDialogContent: {
                        styleOverrides: {
                            root: {
                                paddingTop: 8,
                                paddingBottom: 10,
                                paddingLeft: 14,
                                paddingRight: 14,
                            },
                        },
                    },
                    MuiDialogActions: {
                        styleOverrides: {
                            root: {
                                paddingTop: 8,
                                paddingBottom: 10,
                                paddingLeft: 14,
                                paddingRight: 14,
                                gap: 8,
                            },
                        },
                    },
                    MuiDivider: {
                        styleOverrides: {
                            root: {
                                borderColor: "rgba(148,163,184,0.2)",
                            },
                        },
                    },
                },
            })
        )
        return responsiveFontSizes(merged, { factor: 1.5 })
    }, [])

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    )
}
