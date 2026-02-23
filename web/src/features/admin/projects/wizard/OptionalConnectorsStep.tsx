"use client"

import type { Dispatch, SetStateAction } from "react"
import { Alert, Chip, Paper, Stack, TextField, Typography } from "@mui/material"
import {
    CONNECTOR_LABELS,
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type CreateConnectorType,
    type GitForm,
    type JiraForm,
    type LocalConnectorForm,
} from "@/features/admin/projects/form-model"

type OptionalConnectorsStepProps = {
    createOptionalConnectors: CreateConnectorType[]
    createConnectorChoices: CreateConnectorType[]
    toggleCreateOptionalConnector: (type: CreateConnectorType) => void
    createGitForm: GitForm
    setCreateGitForm: Dispatch<SetStateAction<GitForm>>
    createBitbucketForm: BitbucketForm
    setCreateBitbucketForm: Dispatch<SetStateAction<BitbucketForm>>
    createAzureDevOpsForm: AzureDevOpsForm
    setCreateAzureDevOpsForm: Dispatch<SetStateAction<AzureDevOpsForm>>
    createLocalConnectorForm: LocalConnectorForm
    setCreateLocalConnectorForm: Dispatch<SetStateAction<LocalConnectorForm>>
    createConfluenceForm: ConfluenceForm
    setCreateConfluenceForm: Dispatch<SetStateAction<ConfluenceForm>>
    createJiraForm: JiraForm
    setCreateJiraForm: Dispatch<SetStateAction<JiraForm>>
}

export default function OptionalConnectorsStep(props: OptionalConnectorsStepProps) {
    const {
        createOptionalConnectors,
        createConnectorChoices,
        toggleCreateOptionalConnector,
        createGitForm,
        setCreateGitForm,
        createBitbucketForm,
        setCreateBitbucketForm,
        createAzureDevOpsForm,
        setCreateAzureDevOpsForm,
        createLocalConnectorForm,
        setCreateLocalConnectorForm,
        createConfluenceForm,
        setCreateConfluenceForm,
        createJiraForm,
        setCreateJiraForm,
    } = props

    return (
        <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
                Select additional connectors you want to attach to this project. Only selected connectors show configuration fields.
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {createConnectorChoices.map((type) => {
                    const selected = createOptionalConnectors.includes(type)
                    return (
                        <Chip
                            key={type}
                            label={CONNECTOR_LABELS[type]}
                            clickable
                            color={selected ? "primary" : "default"}
                            variant={selected ? "filled" : "outlined"}
                            onClick={() => toggleCreateOptionalConnector(type)}
                        />
                    )
                })}
            </Stack>

            {!createOptionalConnectors.length && (
                <Alert severity="info">No additional connectors selected.</Alert>
            )}

            {createOptionalConnectors.includes("github") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">GitHub Connector</Typography>
                        <TextField
                            label="Owner"
                            value={createGitForm.owner}
                            onChange={(e) =>
                                setCreateGitForm((f) => ({ ...f, owner: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Repository"
                            value={createGitForm.repo}
                            onChange={(e) =>
                                setCreateGitForm((f) => ({ ...f, repo: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Branch"
                            value={createGitForm.branch}
                            onChange={(e) =>
                                setCreateGitForm((f) => ({ ...f, branch: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Token"
                            value={createGitForm.token}
                            onChange={(e) =>
                                setCreateGitForm((f) => ({ ...f, token: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Paths (comma-separated)"
                            value={createGitForm.paths}
                            onChange={(e) =>
                                setCreateGitForm((f) => ({ ...f, paths: e.target.value }))
                            }
                            placeholder="src, docs"
                            size="small"
                        />
                    </Stack>
                </Paper>
            )}

            {createOptionalConnectors.includes("bitbucket") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">Bitbucket Connector</Typography>
                        <TextField
                            label="Workspace"
                            value={createBitbucketForm.workspace}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Repository Slug"
                            value={createBitbucketForm.repo}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Branch"
                            value={createBitbucketForm.branch}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Username"
                            value={createBitbucketForm.username}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, username: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="App Password"
                            value={createBitbucketForm.app_password}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="API Base URL"
                            value={createBitbucketForm.base_url}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                            }
                            placeholder="https://api.bitbucket.org/2.0"
                            size="small"
                        />
                        <TextField
                            label="Paths (comma-separated)"
                            value={createBitbucketForm.paths}
                            onChange={(e) =>
                                setCreateBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                            }
                            placeholder="src, docs"
                            size="small"
                        />
                    </Stack>
                </Paper>
            )}

            {createOptionalConnectors.includes("azure_devops") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">Azure DevOps Connector</Typography>
                        <TextField
                            label="Organization"
                            value={createAzureDevOpsForm.organization}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({
                                    ...f,
                                    organization: e.target.value,
                                }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Project"
                            value={createAzureDevOpsForm.project}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Repository"
                            value={createAzureDevOpsForm.repository}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({
                                    ...f,
                                    repository: e.target.value,
                                }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Branch"
                            value={createAzureDevOpsForm.branch}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="PAT"
                            value={createAzureDevOpsForm.pat}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="API Base URL"
                            value={createAzureDevOpsForm.base_url}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                            }
                            placeholder="https://dev.azure.com"
                            size="small"
                        />
                        <TextField
                            label="Paths (comma-separated)"
                            value={createAzureDevOpsForm.paths}
                            onChange={(e) =>
                                setCreateAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                            }
                            placeholder="src, docs"
                            size="small"
                        />
                    </Stack>
                </Paper>
            )}

            {createOptionalConnectors.includes("local") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">Local Repository Connector</Typography>
                        <TextField
                            label="Paths (comma-separated)"
                            value={createLocalConnectorForm.paths}
                            onChange={(e) =>
                                setCreateLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                            }
                            placeholder="src, docs"
                            size="small"
                            helperText="Reads from project local repo_path on backend host."
                        />
                    </Stack>
                </Paper>
            )}

            {createOptionalConnectors.includes("confluence") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">Confluence Connector</Typography>
                        <TextField
                            label="Base URL"
                            value={createConfluenceForm.baseUrl}
                            onChange={(e) =>
                                setCreateConfluenceForm((f) => ({
                                    ...f,
                                    baseUrl: e.target.value,
                                }))
                            }
                            placeholder="https://your-domain.atlassian.net/wiki"
                            size="small"
                        />
                        <TextField
                            label="Space Key"
                            value={createConfluenceForm.spaceKey}
                            onChange={(e) =>
                                setCreateConfluenceForm((f) => ({
                                    ...f,
                                    spaceKey: e.target.value,
                                }))
                            }
                            size="small"
                        />
                        <TextField
                            label="Email"
                            value={createConfluenceForm.email}
                            onChange={(e) =>
                                setCreateConfluenceForm((f) => ({ ...f, email: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="API Token"
                            value={createConfluenceForm.apiToken}
                            onChange={(e) =>
                                setCreateConfluenceForm((f) => ({
                                    ...f,
                                    apiToken: e.target.value,
                                }))
                            }
                            size="small"
                        />
                    </Stack>
                </Paper>
            )}

            {createOptionalConnectors.includes("jira") && (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                    <Stack spacing={1.2}>
                        <Typography variant="subtitle2">Jira Connector</Typography>
                        <TextField
                            label="Base URL"
                            value={createJiraForm.baseUrl}
                            onChange={(e) =>
                                setCreateJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                            }
                            placeholder="https://your-domain.atlassian.net"
                            size="small"
                        />
                        <TextField
                            label="Email"
                            value={createJiraForm.email}
                            onChange={(e) =>
                                setCreateJiraForm((f) => ({ ...f, email: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="API Token"
                            value={createJiraForm.apiToken}
                            onChange={(e) =>
                                setCreateJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                            }
                            size="small"
                        />
                        <TextField
                            label="JQL"
                            value={createJiraForm.jql}
                            onChange={(e) =>
                                setCreateJiraForm((f) => ({ ...f, jql: e.target.value }))
                            }
                            placeholder="project = CORE ORDER BY updated DESC"
                            size="small"
                        />
                    </Stack>
                </Paper>
            )}
        </Stack>
    )
}
