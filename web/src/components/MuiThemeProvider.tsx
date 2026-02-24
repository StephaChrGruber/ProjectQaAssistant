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
        mode: "dark",
        primary: {
            main: "#34d399",
            light: "#6ee7b7",
            dark: "#059669",
        },
        secondary: {
            main: "#22d3ee",
            light: "#67e8f9",
            dark: "#0891b2",
        },
        background: {
            default: "#05070f",
            paper: "rgba(14, 20, 33, 0.88)",
        },
        divider: "rgba(148, 163, 184, 0.22)",
        text: {
            primary: "#e6edf8",
            secondary: "#9fb0c9",
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
        "0 1px 2px rgba(2,6,23,0.25)",
        "0 8px 20px rgba(2,6,23,0.2)",
        "0 12px 28px rgba(2,6,23,0.24)",
        "0 18px 34px rgba(2,6,23,0.28)",
        "0 24px 42px rgba(2,6,23,0.3)",
        "0 30px 46px rgba(2,6,23,0.32)",
        "0 36px 52px rgba(2,6,23,0.34)",
        "0 40px 58px rgba(2,6,23,0.36)",
        "0 42px 62px rgba(2,6,23,0.38)",
        "0 44px 64px rgba(2,6,23,0.4)",
        "0 46px 66px rgba(2,6,23,0.42)",
        "0 48px 68px rgba(2,6,23,0.44)",
        "0 50px 70px rgba(2,6,23,0.46)",
        "0 52px 72px rgba(2,6,23,0.48)",
        "0 54px 74px rgba(2,6,23,0.5)",
        "0 56px 76px rgba(2,6,23,0.52)",
        "0 58px 78px rgba(2,6,23,0.54)",
        "0 60px 80px rgba(2,6,23,0.56)",
        "0 62px 82px rgba(2,6,23,0.58)",
        "0 64px 84px rgba(2,6,23,0.6)",
        "0 66px 86px rgba(2,6,23,0.62)",
        "0 68px 88px rgba(2,6,23,0.64)",
        "0 70px 90px rgba(2,6,23,0.66)",
        "0 72px 92px rgba(2,6,23,0.68)",
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
                                    "radial-gradient(1200px 640px at -8% -6%, rgba(34,211,238,0.22), transparent 55%), radial-gradient(900px 560px at 104% -8%, rgba(52,211,153,0.14), transparent 56%), linear-gradient(180deg, #0a1020 0%, #05070f 64%)",
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
                                background: "linear-gradient(135deg, #22d3ee 0%, #34d399 100%)",
                                color: "#04221d",
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
                                backgroundColor: "rgba(15, 23, 42, 0.32)",
                                "& .MuiOutlinedInput-notchedOutline": {
                                    borderColor: "rgba(148,163,184,0.25)",
                                },
                                "&:hover .MuiOutlinedInput-notchedOutline": {
                                    borderColor: "rgba(148,163,184,0.46)",
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
                                borderColor: "rgba(148,163,184,0.26)",
                                backgroundColor: "rgba(7, 12, 24, 0.82)",
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
                                    backgroundColor: "rgba(34,211,238,0.16)",
                                    border: "1px solid rgba(34,211,238,0.38)",
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
