"use client"

import type { Dispatch, SetStateAction } from "react"
import { Checkbox, Chip, FormControlLabel, Paper, Stack, Typography } from "@mui/material"
import {
    CONNECTOR_LABELS,
    type AzureDevOpsForm,
    type BitbucketForm,
    type CreateConnectorType,
    type GitForm,
    type LlmProfileDoc,
    type ProjectForm,
    type RepoSourceMode,
} from "@/features/admin/projects/form-model"

type ReviewStepProps = {
    primaryRepoConnector: CreateConnectorType
    createRepoBranch: string
    createRepoMode: RepoSourceMode
    createForm: ProjectForm
    createGitForm: GitForm
    createBitbucketForm: BitbucketForm
    createAzureDevOpsForm: AzureDevOpsForm
    llmProfiles: LlmProfileDoc[]
    selectedCreateConnectorTypes: CreateConnectorType[]
    ingestOnCreate: boolean
    setIngestOnCreate: Dispatch<SetStateAction<boolean>>
}

export default function ReviewStep(props: ReviewStepProps) {
    const {
        primaryRepoConnector,
        createRepoBranch,
        createRepoMode,
        createForm,
        createGitForm,
        createBitbucketForm,
        createAzureDevOpsForm,
        llmProfiles,
        selectedCreateConnectorTypes,
        ingestOnCreate,
        setIngestOnCreate,
    } = props

    return (
        <Stack spacing={1.5}>
            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                <Stack spacing={1}>
                    <Typography variant="subtitle2">Repository</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Source: {CONNECTOR_LABELS[primaryRepoConnector]}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Branch: {createRepoBranch || "main"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {createRepoMode === "local"
                            ? `Repo path: ${createForm.repo_path || "not set"}`
                            : createRepoMode === "github"
                            ? `Repository: ${createGitForm.owner || "?"}/${createGitForm.repo || "?"}`
                            : createRepoMode === "bitbucket"
                            ? `Repository: ${createBitbucketForm.workspace || "?"}/${createBitbucketForm.repo || "?"}`
                            : `Repository: ${createAzureDevOpsForm.organization || "?"}/${createAzureDevOpsForm.project || "?"}/${createAzureDevOpsForm.repository || "?"}`}
                    </Typography>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                <Stack spacing={1}>
                    <Typography variant="subtitle2">Project</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {createForm.name || "(no name)"} · {createForm.key || "(no key)"}
                    </Typography>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                <Stack spacing={1}>
                    <Typography variant="subtitle2">LLM</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {createForm.llm_profile_id
                            ? `Profile: ${
                                llmProfiles.find((p) => p.id === createForm.llm_profile_id)?.name || createForm.llm_profile_id
                            }`
                            : `${createForm.llm_provider.toUpperCase()} · ${createForm.llm_model || "n/a"}`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                        {createForm.llm_base_url || "backend default"}
                    </Typography>
                </Stack>
            </Paper>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {selectedCreateConnectorTypes.map((type) => (
                    <Chip key={type} label={CONNECTOR_LABELS[type]} color="primary" variant="filled" />
                ))}
            </Stack>

            <FormControlLabel
                control={
                    <Checkbox
                        checked={ingestOnCreate}
                        onChange={(e) => setIngestOnCreate(e.target.checked)}
                    />
                }
                label="Run ingestion immediately after create"
            />
        </Stack>
    )
}
