"use client"

import { useState } from "react"

type Project = { id: string; key: string; name: string }

export default function ProjectPicker({ initialProjects }: { initialProjects: Project[] }) {
    const [projectId, setProjectId] = useState(initialProjects?.[0]?.id ?? "")
    const [question, setQuestion] = useState("")
    const [answer, setAnswer] = useState<string | null>(null)
    const [sources, setSources] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    async function ask() {
        setLoading(true)
        setErr(null)
        setAnswer(null)
        setSources([])
        try {
            const res = await fetch("/api/ask", {
                method: "POST",
                body: JSON.stringify({ projectId, question, topK: 6 }),
                headers: { "Content-Type": "application/json" },
            })
            if (!res.ok) throw new Error(await res.text())
            const data = await res.json()
            setAnswer(data.answer)
            setSources(data.sources || [])
        } catch (e: any) {
            setErr(e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ marginTop: 16, maxWidth: 900 }}>
            <label>
                Project:{" "}
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    {initialProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.key} — {p.name}
                        </option>
                    ))}
                </select>
            </label>

            <div style={{ marginTop: 12 }}>
        <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask something…"
            style={{ width: "100%", minHeight: 90 }}
        />
            </div>

            <button onClick={ask} disabled={!projectId || !question || loading} style={{ marginTop: 8 }}>
                {loading ? "Thinking…" : "Ask"}
            </button>

            {err && <pre style={{ color: "crimson", marginTop: 12 }}>{err}</pre>}

            {answer && (
                <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
                    <h3>Answer</h3>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{answer}</pre>

                    <h3>Sources</h3>
                    <ul>
                        {sources.map((s) => (
                            <li key={s.n}>
                                [{s.n}] <a href={s.url} target="_blank">{s.title}</a> ({s.source})
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
