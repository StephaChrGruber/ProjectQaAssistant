import { backendFetch } from "../../lib/api"

export default async function Admin() {
    const me = await backendFetch("/me")
    return (
        <div style={{ padding: 24, fontFamily: "system-ui" }}>
            <h1>Admin</h1>
            <p>Only authenticated users can see this page. Next step: enforce global admin in backend routes.</p>

            <pre style={{ background: "#f5f5f5", padding: 12 }}>
        {JSON.stringify(me, null, 2)}
      </pre>
        </div>
    )
}
