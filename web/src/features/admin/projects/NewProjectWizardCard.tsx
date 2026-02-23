"use client"

import { Box, Card, CardContent, Divider, Step, StepButton, Stepper, Stack, Typography } from "@mui/material"
import { CREATE_STEPS } from "@/features/admin/projects/form-model"
import type { NewProjectWizardCardProps } from "@/features/admin/projects/NewProjectWizardCard.types"
import LlmStep from "@/features/admin/projects/wizard/LlmStep"
import OptionalConnectorsStep from "@/features/admin/projects/wizard/OptionalConnectorsStep"
import ProjectBasicsStep from "@/features/admin/projects/wizard/ProjectBasicsStep"
import RepositoryStep from "@/features/admin/projects/wizard/RepositoryStep"
import ReviewStep from "@/features/admin/projects/wizard/ReviewStep"
import WizardNavigation from "@/features/admin/projects/wizard/WizardNavigation"

export default function NewProjectWizardCard(props: NewProjectWizardCardProps) {
    const {
        compactWizard,
        wizardStep,
        stepStatus,
        canOpenStep,
        setWizardStep,
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
        createLocalConnectorForm,
        setCreateLocalConnectorForm,
        createConfluenceForm,
        setCreateConfluenceForm,
        createJiraForm,
        setCreateJiraForm,
        createOptionalConnectors,
        createConnectorChoices,
        toggleCreateOptionalConnector,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        loadLlmOptions,
        loadingLlmOptions,
        llmOptionsError,
        defaultBaseUrlForProvider,
        createModelOptions,
        primaryRepoConnector,
        createRepoBranch,
        selectedCreateConnectorTypes,
        ingestOnCreate,
        setIngestOnCreate,
        busy,
        repoValid,
        projectValid,
        llmValid,
        createProjectFromWizard,
        resetCreateWorkflow,
        setError,
    } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Stack spacing={{ xs: 2, md: 2.5 }}>
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            New Project Wizard
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Start with repository setup, then project info, optional connectors, and finally LLM configuration.
                        </Typography>
                    </Box>

                    <Stepper
                        nonLinear
                        activeStep={wizardStep}
                        alternativeLabel={!compactWizard}
                        orientation={compactWizard ? "vertical" : "horizontal"}
                        sx={{
                            "& .MuiStepLabel-label": {
                                fontSize: { xs: "0.8rem", sm: "0.9rem" },
                            },
                        }}
                    >
                        {CREATE_STEPS.map((label, index) => (
                            <Step key={label} completed={index < wizardStep && stepStatus[index]}>
                                <StepButton
                                    color="inherit"
                                    onClick={() => {
                                        if (canOpenStep(index)) {
                                            setWizardStep(index)
                                        }
                                    }}
                                    disabled={!canOpenStep(index)}
                                >
                                    {label}
                                </StepButton>
                            </Step>
                        ))}
                    </Stepper>

                    {wizardStep === 0 && (
                        <RepositoryStep
                            createRepoMode={createRepoMode}
                            setCreateRepoMode={setCreateRepoMode}
                            setPathPickerTarget={setPathPickerTarget}
                            createForm={createForm}
                            setCreateForm={setCreateForm}
                            createGitForm={createGitForm}
                            setCreateGitForm={setCreateGitForm}
                            createBitbucketForm={createBitbucketForm}
                            setCreateBitbucketForm={setCreateBitbucketForm}
                            createAzureDevOpsForm={createAzureDevOpsForm}
                            setCreateAzureDevOpsForm={setCreateAzureDevOpsForm}
                        />
                    )}

                    {wizardStep === 1 && (
                        <ProjectBasicsStep
                            createForm={createForm}
                            setCreateForm={setCreateForm}
                        />
                    )}

                    {wizardStep === 2 && (
                        <OptionalConnectorsStep
                            createOptionalConnectors={createOptionalConnectors}
                            createConnectorChoices={createConnectorChoices}
                            toggleCreateOptionalConnector={toggleCreateOptionalConnector}
                            createGitForm={createGitForm}
                            setCreateGitForm={setCreateGitForm}
                            createBitbucketForm={createBitbucketForm}
                            setCreateBitbucketForm={setCreateBitbucketForm}
                            createAzureDevOpsForm={createAzureDevOpsForm}
                            setCreateAzureDevOpsForm={setCreateAzureDevOpsForm}
                            createLocalConnectorForm={createLocalConnectorForm}
                            setCreateLocalConnectorForm={setCreateLocalConnectorForm}
                            createConfluenceForm={createConfluenceForm}
                            setCreateConfluenceForm={setCreateConfluenceForm}
                            createJiraForm={createJiraForm}
                            setCreateJiraForm={setCreateJiraForm}
                        />
                    )}

                    {wizardStep === 3 && (
                        <LlmStep
                            createForm={createForm}
                            setCreateForm={setCreateForm}
                            llmProfiles={llmProfiles}
                            providerOptions={providerOptions}
                            applyProviderChange={applyProviderChange}
                            loadLlmOptions={loadLlmOptions}
                            loadingLlmOptions={loadingLlmOptions}
                            llmOptionsError={llmOptionsError}
                            defaultBaseUrlForProvider={defaultBaseUrlForProvider}
                            createModelOptions={createModelOptions}
                        />
                    )}

                    {wizardStep === 4 && (
                        <ReviewStep
                            primaryRepoConnector={primaryRepoConnector}
                            createRepoBranch={createRepoBranch}
                            createRepoMode={createRepoMode}
                            createForm={createForm}
                            createGitForm={createGitForm}
                            createBitbucketForm={createBitbucketForm}
                            createAzureDevOpsForm={createAzureDevOpsForm}
                            llmProfiles={llmProfiles}
                            selectedCreateConnectorTypes={selectedCreateConnectorTypes}
                            ingestOnCreate={ingestOnCreate}
                            setIngestOnCreate={setIngestOnCreate}
                        />
                    )}

                    <Divider />

                    <WizardNavigation
                        wizardStep={wizardStep}
                        busy={busy}
                        canOpenStep={canOpenStep}
                        setError={setError}
                        setWizardStep={setWizardStep}
                        createProjectFromWizard={createProjectFromWizard}
                        repoValid={repoValid}
                        projectValid={projectValid}
                        llmValid={llmValid}
                        resetCreateWorkflow={resetCreateWorkflow}
                    />
                </Stack>
            </CardContent>
        </Card>
    )
}
