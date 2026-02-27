import path from "node:path"

export function normalizedMode(raw) {
  const mode = String(raw || "").trim()
  if (mode === "desktop_local_fullstack" || mode === "local_fullstack") return "local_fullstack"
  if (mode === "desktop_remote_slim" || mode === "remote_slim") return "remote_slim"
  return "local_fullstack"
}

export function buildLaunchPlan({
  mode,
  workspaceRoot,
  webPort,
  backendPort,
  mongoPort,
  backendUrl,
  profilePath,
  desktopSessionId,
  webDev,
  mongoBin,
  pythonBin,
  dataDir,
}) {
  const normalized = normalizedMode(mode)
  const root = path.resolve(workspaceRoot)
  const webDir = path.join(root, "web")
  const backendDir = path.join(root, "backend")

  const specs = []
  if (normalized === "local_fullstack" && String(mongoBin || "").trim()) {
    const args = ["--port", String(mongoPort)]
    if (String(dataDir || "").trim()) {
      args.push("--dbpath", path.join(String(dataDir).trim(), "mongo"))
    }
    specs.push({
      name: "mongo",
      cmd: String(mongoBin).trim(),
      args,
      cwd: root,
      env: {},
    })
  }

  if (normalized === "local_fullstack") {
    const env = {
      APP_RUNTIME_MODE: "desktop_local_fullstack",
      APP_BACKEND_ORIGIN: "local",
      DESKTOP_SESSION_ID: desktopSessionId,
      MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}`,
    }
    if (String(profilePath || "").trim()) env.RUNTIME_PROFILE_PATH = String(profilePath).trim()
    specs.push({
      name: "backend",
      cmd: String(pythonBin || "python3").trim() || "python3",
      args: [
        "scripts/run_backend.py",
        "--host",
        "127.0.0.1",
        "--port",
        String(backendPort),
        "--runtime-mode",
        "desktop_local_fullstack",
      ],
      cwd: backendDir,
      env,
    })
  }

  const webEnv = {
    PORT: String(webPort),
    BACKEND_BASE_URL: backendUrl,
    APP_RUNTIME_MODE: normalized === "remote_slim" ? "desktop_remote_slim" : "desktop_local_fullstack",
    DESKTOP_SESSION_ID: desktopSessionId,
  }
  if (String(profilePath || "").trim()) webEnv.RUNTIME_PROFILE_PATH = String(profilePath).trim()

  if (webDev) {
    specs.push({
      name: "web",
      cmd: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "dev"],
      cwd: webDir,
      env: webEnv,
    })
  } else {
    const args = ["run", "start:standalone"]
    if (String(profilePath || "").trim()) {
      args.push("--", "--runtime-profile", String(profilePath).trim())
    }
    specs.push({
      name: "web",
      cmd: process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      cwd: webDir,
      env: webEnv,
    })
  }
  return {
    mode: normalized,
    specs,
  }
}

