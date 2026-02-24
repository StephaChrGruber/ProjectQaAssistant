"use client"

import { useMemo } from "react"
import { Box, Typography } from "@mui/material"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { AutomationRunDoc } from "@/features/automations/types"

type Props = {
  runs: AutomationRunDoc[]
}

type Point = {
  ts: number
  label: string
  succeeded: number
  failed: number
  dry_run: number
}

function fmtBucketLabel(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function AutomationRunsTimeline({ runs }: Props) {
  const points = useMemo<Point[]>(() => {
    const buckets = new Map<number, Point>()
    for (const run of runs || []) {
      const rawTs = run.started_at ? Date.parse(run.started_at) : Number.NaN
      if (!Number.isFinite(rawTs)) continue
      const bucketTs = Math.floor(rawTs / (30 * 60 * 1000)) * (30 * 60 * 1000)
      const current = buckets.get(bucketTs) || {
        ts: bucketTs,
        label: fmtBucketLabel(bucketTs),
        succeeded: 0,
        failed: 0,
        dry_run: 0,
      }
      const status = String(run.status || "").toLowerCase()
      if (status === "failed") current.failed += 1
      else if (status === "dry_run") current.dry_run += 1
      else current.succeeded += 1
      buckets.set(bucketTs, current)
    }
    return [...buckets.values()].sort((a, b) => a.ts - b.ts).slice(-24)
  }, [runs])

  if (!points.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        No run data yet.
      </Typography>
    )
  }

  return (
    <Box sx={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
          <XAxis dataKey="label" minTickGap={24} fontSize={11} />
          <YAxis allowDecimals={false} fontSize={11} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="succeeded" stroke="#22c55e" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="dry_run" stroke="#38bdf8" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  )
}

