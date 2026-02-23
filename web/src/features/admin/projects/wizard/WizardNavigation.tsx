"use client"

import type { Dispatch, SetStateAction } from "react"
import AddRounded from "@mui/icons-material/AddRounded"
import { Button, Stack } from "@mui/material"
import { CREATE_STEPS } from "@/features/admin/projects/form-model"

type WizardNavigationProps = {
    wizardStep: number
    busy: boolean
    canOpenStep: (target: number) => boolean
    setError: Dispatch<SetStateAction<string | null>>
    setWizardStep: Dispatch<SetStateAction<number>>
    createProjectFromWizard: () => Promise<void>
    repoValid: boolean
    projectValid: boolean
    llmValid: boolean
    resetCreateWorkflow: () => void
}

export default function WizardNavigation(props: WizardNavigationProps) {
    const {
        wizardStep,
        busy,
        canOpenStep,
        setError,
        setWizardStep,
        createProjectFromWizard,
        repoValid,
        projectValid,
        llmValid,
        resetCreateWorkflow,
    } = props

    return (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
            <Button
                variant="text"
                disabled={wizardStep === 0 || busy}
                onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
                sx={{ width: { xs: "100%", sm: "auto" } }}
            >
                Back
            </Button>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                {wizardStep < CREATE_STEPS.length - 1 ? (
                    <Button
                        variant="contained"
                        onClick={() => {
                            if (!canOpenStep(wizardStep + 1)) {
                                if (wizardStep === 0) {
                                    setError("Please complete repository setup before continuing.")
                                } else if (wizardStep === 1) {
                                    setError("Please enter project key and name before continuing.")
                                } else if (wizardStep === 3) {
                                    setError("Please choose an LLM profile or set provider and model before continuing.")
                                }
                                return
                            }
                            setError(null)
                            setWizardStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1))
                        }}
                        disabled={busy}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                        Next
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        startIcon={<AddRounded />}
                        onClick={() => void createProjectFromWizard()}
                        disabled={busy || !repoValid || !projectValid || !llmValid}
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                        Create Project
                    </Button>
                )}

                <Button
                    variant="outlined"
                    onClick={resetCreateWorkflow}
                    disabled={busy}
                    sx={{ width: { xs: "100%", sm: "auto" } }}
                >
                    Reset
                </Button>
            </Stack>
        </Stack>
    )
}
