import { buildChatPath } from "@/lib/last-chat"

describe("buildChatPath", () => {
  it("encodes project id and query params", () => {
    const path = buildChatPath("proj/abc", "main", "chat::id")
    expect(path).toBe("/projects/proj%2Fabc/chat?branch=main&chat=chat%3A%3Aid")
  })
})

