"use client"

import type { Dispatch, SetStateAction } from "react"
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import {
    Box,
    Button,
    Card,
    CardContent,
    Divider,
    FormControlLabel,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import type {
    AzureDevOpsForm,
    BitbucketForm,
    ConfluenceForm,
    GitForm,
    JiraForm,
    LocalConnectorForm,
} from "@/features/project-settings/form-model"

type SourceConnectorsCardProps = {
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
    runIngest: () => Promise<void>
    runIncrementalIngest: () => Promise<void>
    savingProject: boolean
    savingConnector: boolean
    ingesting: boolean
    runningIncrementalIngest: boolean
}

export default function SourceConnectorsCard(props: SourceConnectorsCardProps) {
    const {
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
        runIngest,
        runIncrementalIngest,
        savingProject,
        savingConnector,
        ingesting,
        runningIncrementalIngest,
    } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Source Connectors
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                    Configure GitHub, Bitbucket, Azure DevOps, Local Repo, Confluence, and Jira connectors directly here.
                </Typography>

                <Box
                    sx={{
                        mt: 1.5,
                        display: "grid",
                        gap: 1.2,
                        gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0,1fr))" },
                    }}
                >
                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Git Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={gitForm.isEnabled}
                                            onChange={(e) => setGitForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Owner"
                                    value={gitForm.owner}
                                    onChange={(e) => setGitForm((f) => ({ ...f, owner: e.target.value }))}
                                />
                                <TextField
                                    label="Repo"
                                    value={gitForm.repo}
                                    onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                />
                                <TextField
                                    label="Branch"
                                    value={gitForm.branch}
                                    onChange={(e) => setGitForm((f) => ({ ...f, branch: e.target.value }))}
                                />
                                <TextField
                                    label="Token"
                                    value={gitForm.token}
                                    onChange={(e) => setGitForm((f) => ({ ...f, token: e.target.value }))}
                                />
                                <TextField
                                    label="Paths (comma-separated)"
                                    value={gitForm.paths}
                                    onChange={(e) => setGitForm((f) => ({ ...f, paths: e.target.value }))}
                                    placeholder="src, docs"
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("git")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Git
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Bitbucket Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={bitbucketForm.isEnabled}
                                            onChange={(e) =>
                                                setBitbucketForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                            }
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Workspace"
                                    value={bitbucketForm.workspace}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, workspace: e.target.value }))}
                                />
                                <TextField
                                    label="Repository Slug"
                                    value={bitbucketForm.repo}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, repo: e.target.value }))}
                                />
                                <TextField
                                    label="Branch"
                                    value={bitbucketForm.branch}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, branch: e.target.value }))}
                                />
                                <TextField
                                    label="Username"
                                    value={bitbucketForm.username}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, username: e.target.value }))}
                                />
                                <TextField
                                    label="App Password"
                                    value={bitbucketForm.app_password}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, app_password: e.target.value }))}
                                />
                                <TextField
                                    label="API Base URL"
                                    value={bitbucketForm.base_url}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, base_url: e.target.value }))}
                                />
                                <TextField
                                    label="Paths (comma-separated)"
                                    value={bitbucketForm.paths}
                                    onChange={(e) => setBitbucketForm((f) => ({ ...f, paths: e.target.value }))}
                                    placeholder="src, docs"
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("bitbucket")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Bitbucket
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Azure DevOps Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={azureDevOpsForm.isEnabled}
                                            onChange={(e) =>
                                                setAzureDevOpsForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                            }
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Organization"
                                    value={azureDevOpsForm.organization}
                                    onChange={(e) =>
                                        setAzureDevOpsForm((f) => ({ ...f, organization: e.target.value }))
                                    }
                                />
                                <TextField
                                    label="Project"
                                    value={azureDevOpsForm.project}
                                    onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))}
                                />
                                <TextField
                                    label="Repository"
                                    value={azureDevOpsForm.repository}
                                    onChange={(e) =>
                                        setAzureDevOpsForm((f) => ({ ...f, repository: e.target.value }))
                                    }
                                />
                                <TextField
                                    label="Branch"
                                    value={azureDevOpsForm.branch}
                                    onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))}
                                />
                                <TextField
                                    label="PAT"
                                    value={azureDevOpsForm.pat}
                                    onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))}
                                />
                                <TextField
                                    label="API Base URL"
                                    value={azureDevOpsForm.base_url}
                                    onChange={(e) =>
                                        setAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                    }
                                />
                                <TextField
                                    label="Paths (comma-separated)"
                                    value={azureDevOpsForm.paths}
                                    onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))}
                                    placeholder="src, docs"
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("azure_devops")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Azure DevOps
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Local Repository Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={localConnectorForm.isEnabled}
                                            onChange={(e) =>
                                                setLocalConnectorForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                            }
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Paths (comma-separated)"
                                    value={localConnectorForm.paths}
                                    onChange={(e) =>
                                        setLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                                    }
                                    placeholder="src, docs"
                                    helperText="Uses project local repo path on backend."
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("local")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Local Source
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Confluence Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={confluenceForm.isEnabled}
                                            onChange={(e) =>
                                                setConfluenceForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                            }
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Base URL"
                                    value={confluenceForm.baseUrl}
                                    onChange={(e) =>
                                        setConfluenceForm((f) => ({ ...f, baseUrl: e.target.value }))
                                    }
                                    placeholder="https://your-domain.atlassian.net/wiki"
                                />
                                <TextField
                                    label="Space Key"
                                    value={confluenceForm.spaceKey}
                                    onChange={(e) =>
                                        setConfluenceForm((f) => ({ ...f, spaceKey: e.target.value }))
                                    }
                                />
                                <TextField
                                    label="Email"
                                    value={confluenceForm.email}
                                    onChange={(e) => setConfluenceForm((f) => ({ ...f, email: e.target.value }))}
                                />
                                <TextField
                                    label="API Token"
                                    value={confluenceForm.apiToken}
                                    onChange={(e) =>
                                        setConfluenceForm((f) => ({ ...f, apiToken: e.target.value }))
                                    }
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("confluence")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Confluence
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: 1.5 }}>
                            <Stack spacing={1.1}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Jira Source
                                </Typography>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={jiraForm.isEnabled}
                                            onChange={(e) => setJiraForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                        />
                                    }
                                    label="Enabled"
                                />
                                <TextField
                                    label="Base URL"
                                    value={jiraForm.baseUrl}
                                    onChange={(e) => setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))}
                                    placeholder="https://your-domain.atlassian.net"
                                />
                                <TextField
                                    label="Email"
                                    value={jiraForm.email}
                                    onChange={(e) => setJiraForm((f) => ({ ...f, email: e.target.value }))}
                                />
                                <TextField
                                    label="API Token"
                                    value={jiraForm.apiToken}
                                    onChange={(e) => setJiraForm((f) => ({ ...f, apiToken: e.target.value }))}
                                />
                                <TextField
                                    label="JQL"
                                    value={jiraForm.jql}
                                    onChange={(e) => setJiraForm((f) => ({ ...f, jql: e.target.value }))}
                                    placeholder="project = CORE ORDER BY updated DESC"
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() => void saveConnector("jira")}
                                    disabled={savingConnector || savingProject || ingesting}
                                >
                                    Save Jira
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                <Divider sx={{ my: 1.5 }} />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                        After changing sources, run ingestion to refresh indexed context.
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<CloudUploadRounded />}
                            onClick={() => void runIngest()}
                            disabled={ingesting || savingConnector || savingProject || runningIncrementalIngest}
                        >
                            Run Ingestion
                        </Button>
                        <Button
                            variant="outlined"
                            color="success"
                            onClick={() => void runIncrementalIngest()}
                            disabled={runningIncrementalIngest || ingesting || savingConnector || savingProject}
                        >
                            {runningIncrementalIngest ? "Running..." : "Run Incremental"}
                        </Button>
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    )
}
