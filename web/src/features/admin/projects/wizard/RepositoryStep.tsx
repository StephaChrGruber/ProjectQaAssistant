"use client"

import type { Dispatch, SetStateAction } from "react"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import {
    Alert,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
} from "@mui/material"
import type { AzureDevOpsForm, BitbucketForm, GitForm, ProjectForm, RepoSourceMode } from "@/features/admin/projects/form-model"

type RepositoryStepProps = {
    createRepoMode: RepoSourceMode
    setCreateRepoMode: Dispatch<SetStateAction<RepoSourceMode>>
    setPathPickerTarget: Dispatch<SetStateAction<"createRepoPath" | "editRepoPath" | null>>
    createForm: ProjectForm
    setCreateForm: Dispatch<SetStateAction<ProjectForm>>
    createGitForm: GitForm
    setCreateGitForm: Dispatch<SetStateAction<GitForm>>
    createBitbucketForm: BitbucketForm
    setCreateBitbucketForm: Dispatch<SetStateAction<BitbucketForm>>
    createAzureDevOpsForm: AzureDevOpsForm
    setCreateAzureDevOpsForm: Dispatch<SetStateAction<AzureDevOpsForm>>
}

export default function RepositoryStep(props: RepositoryStepProps) {
    const {
        createRepoMode,
        setCreateRepoMode,
        setPathPickerTarget,
        createForm,
        setCreateForm,
        createGitForm,
        setCreateGitForm,
        createBitbucketForm,
        setCreateBitbucketForm,
        createAzureDevOpsForm,
        setCreateAzureDevOpsForm,
    } = props

    return (
        <Stack spacing={1.5}>
            <FormControl fullWidth size="small">
                <InputLabel id="create-repo-source-label">Repository Source</InputLabel>
                <Select
                    labelId="create-repo-source-label"
                    label="Repository Source"
                    value={createRepoMode}
                    onChange={(e) => setCreateRepoMode(e.target.value as RepoSourceMode)}
                >
                    <MenuItem value="local">Local repository path</MenuItem>
                    <MenuItem value="github">GitHub connector</MenuItem>
                    <MenuItem value="bitbucket">Bitbucket connector</MenuItem>
                    <MenuItem value="azure_devops">Azure DevOps connector</MenuItem>
                </Select>
            </FormControl>

            <Alert severity="info">
                Repository comes first. You can add additional connectors in the next step.
            </Alert>

            {createRepoMode === "local" && (
                <Stack spacing={1.2}>
                    <TextField
                        label="Local Repo Path"
                        value={createForm.repo_path}
                        onChange={(e) =>
                            setCreateForm((f) => ({ ...f, repo_path: e.target.value }))
                        }
                        placeholder="/workspace/repo or browser-local://<project>"
                        fullWidth
                        size="small"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        onClick={() => setPathPickerTarget("createRepoPath")}
                                    >
                                        <FolderOpenRounded fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <TextField
                        label="Branch"
                        value={createForm.default_branch}
                        onChange={(e) =>
                            setCreateForm((f) => ({ ...f, default_branch: e.target.value }))
                        }
                        placeholder="main"
                        fullWidth
                        size="small"
                    />
                </Stack>
            )}

            {createRepoMode === "github" && (
                <Stack spacing={1.2}>
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
            )}

            {createRepoMode === "bitbucket" && (
                <Stack spacing={1.2}>
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
            )}

            {createRepoMode === "azure_devops" && (
                <Stack spacing={1.2}>
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
            )}
        </Stack>
    )
}
