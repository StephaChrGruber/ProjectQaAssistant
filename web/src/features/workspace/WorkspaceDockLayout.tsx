"use client"

import { ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { Box } from "@mui/material"

type WorkspaceDockLayoutProps = {
  open: boolean
  width: number
  minWidth?: number
  maxWidth?: number
  onWidthChange: (next: number) => void
  left: ReactNode
  right: ReactNode
}

export function WorkspaceDockLayout({
  open,
  width,
  minWidth = 360,
  maxWidth = 980,
  onWidthChange,
  left,
  right,
}: WorkspaceDockLayoutProps) {
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const onPointerMove = useCallback(
    (ev: PointerEvent) => {
      if (!draggingRef.current) return
      const viewport = window.innerWidth || 1440
      const next = Math.max(minWidth, Math.min(maxWidth, viewport - ev.clientX))
      onWidthChange(next)
    },
    [maxWidth, minWidth, onWidthChange]
  )

  const stopDrag = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
  }, [])

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", stopDrag)
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopDrag)
    }
  }, [onPointerMove, stopDrag])

  return (
    <Box sx={{ minHeight: 0, flex: 1, display: "flex", overflow: "hidden" }}>
      <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>{left}</Box>
      {open && (
        <>
          <Box
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(ev) => {
              ev.preventDefault()
              draggingRef.current = true
              setDragging(true)
            }}
            sx={{
              width: 8,
              cursor: "col-resize",
              borderLeft: "1px solid",
              borderRight: "1px solid",
              borderColor: dragging ? "primary.main" : "divider",
              bgcolor: dragging ? "action.selected" : "transparent",
              transition: "background-color 120ms ease",
            }}
          />
          <Box sx={{ width, minWidth, maxWidth, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {right}
          </Box>
        </>
      )}
    </Box>
  )
}
