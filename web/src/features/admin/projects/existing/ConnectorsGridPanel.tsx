"use client"

import type { Dispatch, SetStateAction } from "react"
import {
    Box,
    Button,
    FormControlLabel,
    Paper,
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
} from "@/features/admin/projects/form-model"

type ConnectorsGridPanelProps = {
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
    busy: boolean
}

export default function ConnectorsGridPanel(props: ConnectorsGridPanelProps) {
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
        busy,
    } = props

    return (
        <Box
            sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                    xs: "1fr",
                    lg: "repeat(3, minmax(0, 1fr))",
                },
            }}
        >
            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Git Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={gitForm.isEnabled}
                                onChange={(e) =>
                                    setGitForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
                                }
                            />
                        }
                        label="Enabled"
                    />
                    <TextField
                        label="Owner"
                        value={gitForm.owner}
                        onChange={(e) =>
                            setGitForm((f) => ({ ...f, owner: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Repo"
                        value={gitForm.repo}
                        onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                        size="small"
                    />
                    <TextField
                        label="Branch"
                        value={gitForm.branch}
                        onChange={(e) =>
                            setGitForm((f) => ({ ...f, branch: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Token"
                        value={gitForm.token}
                        onChange={(e) =>
                            setGitForm((f) => ({ ...f, token: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Paths (comma-separated)"
                        value={gitForm.paths}
                        onChange={(e) =>
                            setGitForm((f) => ({ ...f, paths: e.target.value }))
                        }
                        placeholder="src, docs"
                        size="small"
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("git")}
                        disabled={busy}
                    >
                        Save Git
                    </Button>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Bitbucket Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={bitbucketForm.isEnabled}
                                onChange={(e) =>
                                    setBitbucketForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
                                }
                            />
                        }
                        label="Enabled"
                    />
                    <TextField
                        label="Workspace"
                        value={bitbucketForm.workspace}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Repository Slug"
                        value={bitbucketForm.repo}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Branch"
                        value={bitbucketForm.branch}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Username"
                        value={bitbucketForm.username}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, username: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="App Password"
                        value={bitbucketForm.app_password}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="API Base URL"
                        value={bitbucketForm.base_url}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                        }
                        placeholder="https://api.bitbucket.org/2.0"
                        size="small"
                    />
                    <TextField
                        label="Paths (comma-separated)"
                        value={bitbucketForm.paths}
                        onChange={(e) =>
                            setBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                        }
                        placeholder="src, docs"
                        size="small"
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("bitbucket")}
                        disabled={busy}
                    >
                        Save Bitbucket
                    </Button>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Azure DevOps Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={azureDevOpsForm.isEnabled}
                                onChange={(e) =>
                                    setAzureDevOpsForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
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
                        size="small"
                    />
                    <TextField
                        label="Project"
                        value={azureDevOpsForm.project}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Repository"
                        value={azureDevOpsForm.repository}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, repository: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Branch"
                        value={azureDevOpsForm.branch}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="PAT"
                        value={azureDevOpsForm.pat}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="API Base URL"
                        value={azureDevOpsForm.base_url}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                        }
                        placeholder="https://dev.azure.com"
                        size="small"
                    />
                    <TextField
                        label="Paths (comma-separated)"
                        value={azureDevOpsForm.paths}
                        onChange={(e) =>
                            setAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                        }
                        placeholder="src, docs"
                        size="small"
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("azure_devops")}
                        disabled={busy}
                    >
                        Save Azure DevOps
                    </Button>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Local Repository Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={localConnectorForm.isEnabled}
                                onChange={(e) =>
                                    setLocalConnectorForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
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
                        size="small"
                        helperText="Reads from the configured project repo path."
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("local")}
                        disabled={busy}
                    >
                        Save Local Source
                    </Button>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Confluence Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={confluenceForm.isEnabled}
                                onChange={(e) =>
                                    setConfluenceForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
                                }
                            />
                        }
                        label="Enabled"
                    />
                    <TextField
                        label="Base URL"
                        value={confluenceForm.baseUrl}
                        onChange={(e) =>
                            setConfluenceForm((f) => ({
                                ...f,
                                baseUrl: e.target.value,
                            }))
                        }
                        placeholder="https://your-domain.atlassian.net/wiki"
                        size="small"
                    />
                    <TextField
                        label="Space Key"
                        value={confluenceForm.spaceKey}
                        onChange={(e) =>
                            setConfluenceForm((f) => ({
                                ...f,
                                spaceKey: e.target.value,
                            }))
                        }
                        size="small"
                    />
                    <TextField
                        label="Email"
                        value={confluenceForm.email}
                        onChange={(e) =>
                            setConfluenceForm((f) => ({ ...f, email: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="API Token"
                        value={confluenceForm.apiToken}
                        onChange={(e) =>
                            setConfluenceForm((f) => ({
                                ...f,
                                apiToken: e.target.value,
                            }))
                        }
                        size="small"
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("confluence")}
                        disabled={busy}
                    >
                        Save Confluence
                    </Button>
                </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack spacing={1.2}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Jira Source
                    </Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={jiraForm.isEnabled}
                                onChange={(e) =>
                                    setJiraForm((f) => ({
                                        ...f,
                                        isEnabled: e.target.checked,
                                    }))
                                }
                            />
                        }
                        label="Enabled"
                    />
                    <TextField
                        label="Base URL"
                        value={jiraForm.baseUrl}
                        onChange={(e) =>
                            setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                        }
                        placeholder="https://your-domain.atlassian.net"
                        size="small"
                    />
                    <TextField
                        label="Email"
                        value={jiraForm.email}
                        onChange={(e) =>
                            setJiraForm((f) => ({ ...f, email: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="API Token"
                        value={jiraForm.apiToken}
                        onChange={(e) =>
                            setJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                        }
                        size="small"
                    />
                    <TextField
                        label="JQL"
                        value={jiraForm.jql}
                        onChange={(e) =>
                            setJiraForm((f) => ({ ...f, jql: e.target.value }))
                        }
                        placeholder="project = CORE ORDER BY updated DESC"
                        size="small"
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void saveConnector("jira")}
                        disabled={busy}
                    >
                        Save Jira
                    </Button>
                </Stack>
            </Paper>
        </Box>
    )
}
