import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(req: Request) {
    const body = await req.json()

    // Accept whatever the UI sends, normalize to what backend expects.
    const payload = {
        project_id: body.project_id ?? body.projectId ?? body.project_key ?? body.projectKey,
        project_key: body.project_key ?? body.projectKey ?? body.project_id ?? body.projectId,
        branch: body.branch ?? "main",
        user: body.user ?? "dev",
        chat_id: body.chat_id ?? body.chatId ?? null,
        top_k: body.top_k ?? body.topK ?? 8,
        llm_base_url: body.llm_base_url ?? body.llmBaseUrl ?? null,
        llm_api_key: body.llm_api_key ?? body.llmApiKey ?? null,
        llm_model: body.llm_model ?? body.llmModel ?? null,
        llm_profile_id: body.llm_profile_id ?? body.llmProfileId ?? null,
        dry_run: body.dry_run ?? body.dryRun ?? null,
        pending_question_id: body.pending_question_id ?? body.pendingQuestionId ?? null,
        pending_answer: body.pending_answer ?? body.pendingAnswer ?? null,
        context_key: body.context_key ?? body.contextKey ?? null,
        include_pinned_memory: body.include_pinned_memory ?? body.includePinnedMemory ?? true,
        history_mode: body.history_mode ?? body.historyMode ?? "active_plus_pinned",

        // IMPORTANT: backend expects "question"
        question: body.question ?? body.query ?? "",
        local_repo_context: body.local_repo_context ?? body.localRepoContext ?? null,
    }

    const res = await fetchBackend("/ask_agent", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    })
    return proxyJsonResponse(res)
}
