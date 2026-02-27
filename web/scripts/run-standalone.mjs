#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name)
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback
  return String(process.argv[idx + 1] || "").trim() || fallback
}

function loadProfile(profilePath) {
  if (!profilePath) return {}
  try {
    const full = path.resolve(profilePath)
    if (!fs.existsSync(full)) return {}
    const raw = fs.readFileSync(full, "utf8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? parsed : {}
  } catch {
    return {}
  }
}

const profilePath = argValue("--runtime-profile", process.env.RUNTIME_PROFILE_PATH || "")
const profile = loadProfile(profilePath)
const mode = String(process.env.APP_RUNTIME_MODE || profile.mode || "server").trim()

const localPorts = profile.local_ports && typeof profile.local_ports === "object" ? profile.local_ports : {}
const webPort = Number(process.env.PORT || localPorts.web || 3000)
const backendPort = Number(localPorts.backend || 8080)
const backendUrl =
  process.env.BACKEND_BASE_URL ||
  (mode === "remote_slim" || mode === "desktop_remote_slim"
    ? String(profile.backend_url || "http://127.0.0.1:8080")
    : `http://127.0.0.1:${backendPort}`)

const env = {
  ...process.env,
  PORT: String(webPort),
  BACKEND_BASE_URL: backendUrl,
}

const serverJs = path.resolve(".next", "standalone", "server.js")
if (!fs.existsSync(serverJs)) {
  console.error(`Missing standalone server build: ${serverJs}`)
  console.error("Run `npm run build` before starting standalone mode.")
  process.exit(1)
}

const child = spawn(process.execPath, [serverJs], {
  stdio: "inherit",
  env,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

