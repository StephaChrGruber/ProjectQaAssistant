import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { EditorTabs } from "@/features/workspace/EditorTabs"
import type { WorkspaceOpenTab } from "@/features/workspace/types"

vi.mock("@monaco-editor/react", () => ({
  default: (props: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      data-testid="monaco-editor"
      value={props.value || ""}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}))

function buildTab(overrides?: Partial<WorkspaceOpenTab>): WorkspaceOpenTab {
  return {
    path: "src/main.ts",
    savedContent: "const a = 1\n",
    draftContent: "const a = 1\n",
    dirty: false,
    draftDirty: false,
    mode: "local",
    language: "typescript",
    ...overrides,
  }
}

describe("EditorTabs", () => {
  it("shows large-file read-only notice and triggers open-full callback", () => {
    const onOpenFullFile = vi.fn()
    const onSave = vi.fn()

    render(
      <EditorTabs
        tabs={[buildTab({ readOnly: true, readOnlyReason: "large_file" })]}
        activePath="src/main.ts"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onChangeContent={() => {}}
        onSaveActive={onSave}
        saving={false}
        onOpenFullFile={onOpenFullFile}
      />
    )

    expect(screen.getByText(/Large file opened as preview/i)).toBeInTheDocument()
    const saveButton = screen.getByLabelText("Save active file")
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /Open full file/i }))
    expect(onOpenFullFile).toHaveBeenCalledTimes(1)
  })

  it("shows binary-file read-only notice without open-full button", () => {
    render(
      <EditorTabs
        tabs={[buildTab({ readOnly: true, readOnlyReason: "binary_file" })]}
        activePath="src/main.ts"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onChangeContent={() => {}}
        onSaveActive={() => {}}
        saving={false}
      />
    )

    expect(screen.getByText(/Binary files are read-only/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Open full file/i })).toBeNull()
  })
})
