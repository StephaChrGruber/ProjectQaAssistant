import { backendFetch } from "../lib/api"
import ProjectPicker from "../components/ProjectPicker"

export default async function Home() {
    const me = await backendFetch("/me")
    return (
        <div style={{ padding: 24, fontFamily: "system-ui" }}>
            <h1>Project Q&A</h1>
            <p>Signed in as: {me.user.email}</p>

            <ProjectPicker initialProjects={me.projects} />
        </div>
    )
}
