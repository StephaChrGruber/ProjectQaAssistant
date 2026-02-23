"use client"

import { ComponentType, Dispatch, SetStateAction } from "react"
import ProjectSettingsFormCard from "@/features/project-settings/admin/ProjectSettingsFormCard"
import SourceConnectorsCard from "@/features/project-settings/admin/SourceConnectorsCard"
import ReliabilityDashboardCard from "@/features/project-settings/admin/ReliabilityDashboardCard"
import EvaluationRunnerCard from "@/features/project-settings/admin/EvaluationRunnerCard"
import FeatureFlagsCard from "@/features/project-settings/admin/FeatureFlagsCard"
import {
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConnectorHealthResponse,
    type ConfluenceForm,
    type EvalRunResponse,
    type FeatureFlags,
    type GitForm,
    type JiraForm,
    type LlmProfileDoc,
    type LlmProviderOption,
    type LocalConnectorForm,
    type ProjectEditForm,
    type QaMetricsResponse,
} from "@/features/project-settings/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type ProjectSettingsAdminPanelProps = {
    editForm: ProjectEditForm
    setEditForm: Dispatch<SetStateAction<ProjectEditForm>>
    isBrowserLocalRepoPath: (path: string) => boolean
    localRepoConfiguredInBrowser: boolean
    setPathPickerOpen: Dispatch<SetStateAction<boolean>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (nextProvider: string) => void
    editModelOptions: string[]
    onSaveProjectSettings: () => Promise<void>
    savingProject: boolean
    savingConnector: boolean
    ingesting: boolean
    loadLlmOptions: (opts?: LoadOptionsArgs) => Promise<void>
    loadingLlmOptions: boolean
    llmOptionsError: string | null
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
    runningIncrementalIngest: boolean
    runIncrementalIngest: () => Promise<void>
    loadQaMetrics: () => Promise<void>
    loadingQaMetrics: boolean
    qaMetrics: QaMetricsResponse | null
    evaluationQuestions: string
    setEvaluationQuestions: Dispatch<SetStateAction<string>>
    runEvaluations: () => Promise<void>
    runningEvaluations: boolean
    latestEvalRun: EvalRunResponse | null
    featureFlags: FeatureFlags
    setFeatureFlags: Dispatch<SetStateAction<FeatureFlags>>
    saveFeatureFlags: () => Promise<void>
    savingFeatureFlags: boolean
    connectorHealth: ConnectorHealthResponse | null
    loadingConnectorHealth: boolean
    refreshConnectorHealth: () => Promise<void>
    DetailCardComponent: ComponentType<{ title: string; value: string }>
}

export default function ProjectSettingsAdminPanel(props: ProjectSettingsAdminPanelProps) {
    const {
        editForm,
        setEditForm,
        isBrowserLocalRepoPath,
        localRepoConfiguredInBrowser,
        setPathPickerOpen,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        editModelOptions,
        onSaveProjectSettings,
        savingProject,
        savingConnector,
        ingesting,
        loadLlmOptions,
        loadingLlmOptions,
        llmOptionsError,
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
        runningIncrementalIngest,
        runIncrementalIngest,
        loadQaMetrics,
        loadingQaMetrics,
        qaMetrics,
        evaluationQuestions,
        setEvaluationQuestions,
        runEvaluations,
        runningEvaluations,
        latestEvalRun,
        featureFlags,
        setFeatureFlags,
        saveFeatureFlags,
        savingFeatureFlags,
        connectorHealth,
        loadingConnectorHealth,
        refreshConnectorHealth,
        DetailCardComponent,
    } = props

    return (
        <>
            <ProjectSettingsFormCard
                editForm={editForm}
                setEditForm={setEditForm}
                isBrowserLocalRepoPath={isBrowserLocalRepoPath}
                localRepoConfiguredInBrowser={localRepoConfiguredInBrowser}
                setPathPickerOpen={setPathPickerOpen}
                llmProfiles={llmProfiles}
                providerOptions={providerOptions}
                applyProviderChange={applyProviderChange}
                editModelOptions={editModelOptions}
                onSaveProjectSettings={onSaveProjectSettings}
                savingProject={savingProject}
                savingConnector={savingConnector}
                ingesting={ingesting}
                loadLlmOptions={loadLlmOptions}
                loadingLlmOptions={loadingLlmOptions}
                llmOptionsError={llmOptionsError}
            />

            <SourceConnectorsCard
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
                runIngest={runIngest}
                runIncrementalIngest={runIncrementalIngest}
                savingProject={savingProject}
                savingConnector={savingConnector}
                ingesting={ingesting}
                runningIncrementalIngest={runningIncrementalIngest}
            />

            <ReliabilityDashboardCard
                qaMetrics={qaMetrics}
                loadQaMetrics={loadQaMetrics}
                loadingQaMetrics={loadingQaMetrics}
                DetailCardComponent={DetailCardComponent}
            />

            <EvaluationRunnerCard
                evaluationQuestions={evaluationQuestions}
                setEvaluationQuestions={setEvaluationQuestions}
                runEvaluations={runEvaluations}
                runningEvaluations={runningEvaluations}
                latestEvalRun={latestEvalRun}
                DetailCardComponent={DetailCardComponent}
            />

            <FeatureFlagsCard
                featureFlags={featureFlags}
                onChange={setFeatureFlags}
                onSave={saveFeatureFlags}
                saving={savingFeatureFlags}
                connectorHealth={connectorHealth}
                connectorHealthLoading={loadingConnectorHealth}
                onRefreshConnectorHealth={refreshConnectorHealth}
            />
        </>
    )
}
