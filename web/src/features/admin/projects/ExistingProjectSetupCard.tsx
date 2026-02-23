"use client"

import { Dispatch, FormEvent, SetStateAction } from "react"
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from "@mui/material"
import ConnectorsGridPanel from "@/features/admin/projects/existing/ConnectorsGridPanel"
import IngestionPanel from "@/features/admin/projects/existing/IngestionPanel"
import ProjectDetailsPanel from "@/features/admin/projects/existing/ProjectDetailsPanel"
import {
    type AdminProject,
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type GitForm,
    type JiraForm,
    type LlmProfileDoc,
    type LlmProviderOption,
    type LocalConnectorForm,
    type ProjectForm,
} from "@/features/admin/projects/form-model"

type ExistingProjectSetupCardProps = {
    selectedProjectId: string | null
    setSelectedProjectId: Dispatch<SetStateAction<string | null>>
    projects: AdminProject[]
    selectedProject: AdminProject | undefined
    busy: boolean
    setDeleteConfirmKey: Dispatch<SetStateAction<string>>
    setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>
    onSaveProject: (e: FormEvent<HTMLFormElement>) => void | Promise<void>
    editForm: ProjectForm
    setEditForm: Dispatch<SetStateAction<ProjectForm>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (setForm: Dispatch<SetStateAction<ProjectForm>>, nextProvider: string) => void
    editModelOptions: string[]
    setPathPickerTarget: Dispatch<SetStateAction<"createRepoPath" | "editRepoPath" | null>>
    gitForm: GitForm
    setGitForm: Dispatch<SetStateAction<GitForm>>
    bitbucketForm: BitbucketForm
    setBitbucketForm: Dispatch<SetStateAction<BitbucketForm>>
    azureDevOpsForm: AzureDevOpsForm
    setAzureDevOpsForm: Dispatch<SetStateAction<AzureDevOpsForm>>
    localConnectorForm: LocalConnectorForm
    setLocalConnectorForm: Dispatch<SetStateAction<LocalConnectorForm>>
    confluenceForm: ConfluenceForm
    setConfluenceForm: Dispatch<SetStateAction<ConfluenceForm>>
    jiraForm: JiraForm
    setJiraForm: Dispatch<SetStateAction<JiraForm>>
    saveConnector: (type: "git" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira") => Promise<void>
    refreshProjects: (preferredProjectId?: string) => Promise<void>
    runIngest: (projectId: string) => Promise<void>
}

export default function ExistingProjectSetupCard(props: ExistingProjectSetupCardProps) {
    const {
        selectedProjectId,
        setSelectedProjectId,
        projects,
        selectedProject,
        busy,
        setDeleteConfirmKey,
        setDeleteDialogOpen,
        onSaveProject,
        editForm,
        setEditForm,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        editModelOptions,
        setPathPickerTarget,
        gitForm,
        setGitForm,
        bitbucketForm,
        setBitbucketForm,
        azureDevOpsForm,
        setAzureDevOpsForm,
        localConnectorForm,
        setLocalConnectorForm,
        confluenceForm,
        setConfluenceForm,
        jiraForm,
        setJiraForm,
        saveConnector,
        refreshProjects,
        runIngest,
    } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Stack spacing={2}>
                    <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1.5}
                        alignItems={{ xs: "stretch", sm: "center" }}
                    >
                        <Box>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Existing Project Setup
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Update project metadata, connectors, and run ingestion.
                            </Typography>
                        </Box>

                        <FormControl size="small" sx={{ ml: { sm: "auto" }, minWidth: { xs: "100%", sm: 280 } }}>
                            <InputLabel id="selected-project-label">Project</InputLabel>
                            <Select
                                labelId="selected-project-label"
                                label="Project"
                                value={selectedProjectId || ""}
                                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                            >
                                {projects.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.name} ({p.key})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteForeverRounded />}
                            disabled={!selectedProject || busy}
                            onClick={() => {
                                setDeleteConfirmKey("")
                                setDeleteDialogOpen(true)
                            }}
                            sx={{ width: { xs: "100%", sm: "auto" } }}
                        >
                            Delete Project
                        </Button>
                    </Stack>

                    {!selectedProject && <Alert severity="info">No project selected.</Alert>}

                    {selectedProject && (
                        <Stack spacing={2}>
                            <ProjectDetailsPanel
                                onSaveProject={onSaveProject}
                                editForm={editForm}
                                setEditForm={setEditForm}
                                llmProfiles={llmProfiles}
                                providerOptions={providerOptions}
                                applyProviderChange={applyProviderChange}
                                editModelOptions={editModelOptions}
                                setPathPickerTarget={setPathPickerTarget}
                                busy={busy}
                            />

                            <ConnectorsGridPanel
                                gitForm={gitForm}
                                setGitForm={setGitForm}
                                bitbucketForm={bitbucketForm}
                                setBitbucketForm={setBitbucketForm}
                                azureDevOpsForm={azureDevOpsForm}
                                setAzureDevOpsForm={setAzureDevOpsForm}
                                localConnectorForm={localConnectorForm}
                                setLocalConnectorForm={setLocalConnectorForm}
                                confluenceForm={confluenceForm}
                                setConfluenceForm={setConfluenceForm}
                                jiraForm={jiraForm}
                                setJiraForm={setJiraForm}
                                saveConnector={saveConnector}
                                busy={busy}
                            />

                            <IngestionPanel
                                projectId={selectedProject.id}
                                busy={busy}
                                refreshProjects={refreshProjects}
                                runIngest={runIngest}
                            />
                        </Stack>
                    )}
                </Stack>
            </CardContent>
        </Card>
    )
}
