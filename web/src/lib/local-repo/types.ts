export type LocalRepoFile = {
    path: string
    content: string
}

export type LocalRepoSnapshot = {
    rootName: string
    files: LocalRepoFile[]
    indexedAt: string
}

export type LocalRepoSession = {
    snapshot: LocalRepoSnapshot
    rootHandle?: FileSystemDirectoryHandle | null
}

export type LocalDocumentationContext = {
    repo_root: string
    file_paths: string[]
    context: string
}

export type LocalRepoGitBranches = {
    activeBranch: string
    detached: boolean
    branches: string[]
}

export type LocalRepoGitCreateBranchReq = {
    branch: string
    sourceRef?: string | null
    checkout?: boolean
}

export type LocalRepoGitCreateBranchRes = {
    branch: string
    sourceRef: string
    checkedOut: boolean
    currentBranch: string
}

export type LocalRepoGitCheckoutBranchReq = {
    branch: string
    createIfMissing?: boolean
    startPoint?: string | null
}

export type LocalRepoGitCheckoutBranchRes = {
    branch: string
    previousBranch: string | null
    created: boolean
}

export type LocalRepoHit = {
    term: string
    path: string
    line: number
    column: number
    snippet: string
}
