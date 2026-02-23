"use client"

import { useEffect } from "react"
import { backendJson } from "@/lib/backend"
import { executeLocalToolJob } from "@/lib/local-custom-tool-runner"
import type { LocalToolClaimResponse } from "@/features/chat/types"

type UseLocalToolJobWorkerOptions = {
    claimIdPrefix: string
    buildClaimPayload: () => Record<string, unknown>
    intervalMs?: number
}

export function useLocalToolJobWorker({
    claimIdPrefix,
    buildClaimPayload,
    intervalMs = 900,
}: UseLocalToolJobWorkerOptions) {
    useEffect(() => {
        let stopped = false
        let inFlight = false
        const claimId = `${claimIdPrefix}-${Math.random().toString(36).slice(2, 10)}`

        async function tick() {
            if (stopped || inFlight) return
            inFlight = true
            try {
                const sharedPayload = buildClaimPayload()
                const claim = await backendJson<LocalToolClaimResponse>("/api/local-tools/jobs/claim", {
                    method: "POST",
                    body: JSON.stringify({
                        ...sharedPayload,
                        claimId,
                    }),
                })
                const job = claim.job
                if (!job?.id) return

                try {
                    const result = await executeLocalToolJob(job)
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/complete`, {
                        method: "POST",
                        body: JSON.stringify({ ...sharedPayload, claimId, result }),
                    })
                } catch (err) {
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/fail`, {
                        method: "POST",
                        body: JSON.stringify({
                            ...sharedPayload,
                            claimId,
                            error: err instanceof Error ? err.message : String(err),
                        }),
                    })
                }
            } catch {
                // Keep the worker silent when no jobs are available or network errors are transient.
            } finally {
                inFlight = false
            }
        }

        const timer = window.setInterval(() => {
            void tick()
        }, intervalMs)
        void tick()

        return () => {
            stopped = true
            window.clearInterval(timer)
        }
    }, [buildClaimPayload, claimIdPrefix, intervalMs])
}
