import { shouldPromptConversationSwitch } from "@/features/chat/conversation-switch"

describe("shouldPromptConversationSwitch", () => {
  it("returns false when context is unchanged", () => {
    expect(
      shouldPromptConversationSwitch({
        currentProjectId: "p1",
        currentBranch: "main",
        nextProjectId: "p1",
        nextBranch: "main",
        dirtyDraftCount: 3,
      })
    ).toBe(false)
  })

  it("returns false when there are no dirty drafts", () => {
    expect(
      shouldPromptConversationSwitch({
        currentProjectId: "p1",
        currentBranch: "main",
        nextProjectId: "p1",
        nextBranch: "feature/a",
        dirtyDraftCount: 0,
      })
    ).toBe(false)
  })

  it("returns true when switching branch with dirty drafts", () => {
    expect(
      shouldPromptConversationSwitch({
        currentProjectId: "p1",
        currentBranch: "main",
        nextProjectId: "p1",
        nextBranch: "feature/a",
        dirtyDraftCount: 1,
      })
    ).toBe(true)
  })
})

