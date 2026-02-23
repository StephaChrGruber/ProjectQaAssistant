"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactNode, useState } from "react"
import { MuiThemeProvider } from "@/components/MuiThemeProvider"

type Props = {
  children: ReactNode
}

export function AppProviders({ children }: Props) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <MuiThemeProvider>{children}</MuiThemeProvider>
    </QueryClientProvider>
  )
}

