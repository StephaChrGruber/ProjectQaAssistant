export function shouldPromptConversationSwitch(input: {
  currentProjectId: string
  currentBranch: string
  nextProjectId: string
  nextBranch: string
  dirtyDraftCount: number
}): boolean {
  const changingContext =
    input.nextProjectId !== input.currentProjectId || input.nextBranch !== input.currentBranch
  return changingContext && input.dirtyDraftCount > 0
}
