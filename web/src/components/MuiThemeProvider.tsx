"use client"

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material"
import { deepmerge } from "@mui/utils"
import { ReactNode, useMemo } from "react"

type Props = {
    children: ReactNode
}

const baseTheme = createTheme({
    palette: {
        mode: "dark",
        primary: {
            main: "#80deea",
        },
        secondary: {
            main: "#a5d6a7",
        },
        background: {
            default: "#05050a",
            paper: "rgba(21, 25, 42, 0.86)",
        },
    },
    shape: {
        borderRadius: 16,
    },
    typography: {
        fontFamily: [
            "Space Grotesk",
            "Sora",
            "Avenir Next",
            "Segoe UI",
            "sans-serif",
        ].join(","),
        button: {
            textTransform: "none",
            fontWeight: 600,
        },
    },
})

export function MuiThemeProvider({ children }: Props) {
    const theme = useMemo(
        () =>
            createTheme(
                deepmerge(baseTheme, {
                    components: {
                        MuiDrawer: {
                            styleOverrides: {
                                paper: {
                                    backdropFilter: "blur(14px)",
                                    borderColor: "rgba(255,255,255,0.1)",
                                },
                            },
                        },
                        MuiAppBar: {
                            styleOverrides: {
                                root: {
                                    backdropFilter: "blur(14px)",
                                },
                            },
                        },
                        MuiPaper: {
                            styleOverrides: {
                                root: {
                                    backgroundImage: "none",
                                },
                            },
                        },
                    },
                })
            ),
        []
    )

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    )
}

