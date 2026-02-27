#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildLaunchPlan, normalizedMode } from "./runtime-launch-plan.mjs"

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name)
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback
  return String(process.argv[idx + 1] || "").trim() || fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function parseProfile(profilePath) {
  if (!profilePath) return {}
  try {
    const full = path.resolve(profilePath)
    if (!fs.existsSync(full)) return {}
    const parsed = JSON.parse(fs.readFileSync(full, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function spawnSidecar(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  return child
}

const scriptPath = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(scriptPath), "..", "..")

const profilePath = argValue("--profile", process.env.RUNTIME_PROFILE_PATH || "")
const profile = parseProfile(profilePath)
const mode = normalizedMode(argValue("--mode", process.env.APP_RUNTIME_MODE || profile.mode || "local_fullstack"))
const localPorts = profile.local_ports && typeof profile.local_ports === "object" ? profile.local_ports : {}
const webPort = Number(process.env.WEB_PORT || localPorts.web || 3000)
const backendPort = Number(process.env.BACKEND_PORT || localPorts.backend || 8080)
const mongoPort = Number(process.env.MONGO_PORT || localPorts.mongo || 27017)
const desktopSessionId = process.env.DESKTOP_SESSION_ID || `desktop-${Date.now()}`
const dataDir = String(process.env.APP_DATA_DIR || profile.data_dir || "").trim()
const remoteBackendUrl = String(process.env.BACKEND_BASE_URL || profile.backend_url || "").trim()
const mongoBin = String(process.env.MONGOD_BIN || argValue("--mongo-bin", "")).trim()
const pythonBin = String(process.env.PYTHON_BIN || "python3").trim()
const useDevWeb = hasFlag("--web-dev")
const dryRun = hasFlag("--dry-run")
const autoRestart = !hasFlag("--no-auto-restart")

const childrenByName = new Map()
let shuttingDown = false
const restartBudget = new Map()

function restartAllowed(name) {
  const now = Date.now()
  const windowMs = 90_000
  const maxRestarts = 6
  const row = restartBudget.get(name) || { attempts: 0, firstAt: now }
  if (now - row.firstAt > windowMs) {
    row.attempts = 0
    row.firstAt = now
  }
  if (row.attempts >= maxRestarts) {
    return false
  }
  row.attempts += 1
  restartBudget.set(name, row)
  return true
}

function spawnManagedSidecar(spec, reason = "start") {
  if (spec.name === "mongo") {
    const dbPathIdx = spec.args.indexOf("--dbpath")
    if (dbPathIdx >= 0 && dbPathIdx + 1 < spec.args.length) {
      const dbPath = String(spec.args[dbPathIdx + 1] || "").trim()
      if (dbPath) fs.mkdirSync(dbPath, { recursive: true })
    }
  }
  const child = spawnSidecar(spec.name, spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      ...(spec.env || {}),
    },
  })
  childrenByName.set(spec.name, child)
  if (reason !== "start") {
    console.log(`[desktop] restarted sidecar ${spec.name}`)
  }
  child.on("exit", (code, signal) => {
    const current = childrenByName.get(spec.name)
    if (!current || current.pid !== child.pid) return
    childrenByName.delete(spec.name)
    if (signal) {
      console.log(`[${spec.name}] exited via signal ${signal}`)
    } else {
      console.log(`[${spec.name}] exited with code ${code ?? 0}`)
    }
    if (shuttingDown || !autoRestart) return
    if (!restartAllowed(spec.name)) {
      console.error(`[desktop] auto-restart disabled for ${spec.name}: restart budget exhausted`)
      return
    }
    setTimeout(() => {
      if (shuttingDown) return
      spawnManagedSidecar(spec, "restart")
    }, 1200)
  })
  return child
}

function killAll() {
  shuttingDown = true
  for (const child of childrenByName.values()) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" })
      } else {
        process.kill(child.pid, "SIGTERM")
      }
    } catch {
      // ignore kill failures
    }
  }
}

process.on("SIGINT", () => {
  killAll()
  process.exit(0)
})
process.on("SIGTERM", () => {
  killAll()
  process.exit(0)
})

const backendUrl = mode === "remote_slim" ? remoteBackendUrl || "http://127.0.0.1:8080" : `http://127.0.0.1:${backendPort}`
const plan = buildLaunchPlan({
  mode,
  workspaceRoot: root,
  webPort,
  backendPort,
  mongoPort,
  backendUrl,
  profilePath,
  desktopSessionId,
  webDev: useDevWeb,
  mongoBin,
  pythonBin,
  dataDir,
})

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: plan.mode,
        webPort,
        backendPort,
        mongoPort,
        specs: plan.specs,
      },
      null,
      2
    )}\n`
  )
  process.exit(0)
}

for (const spec of plan.specs) spawnManagedSidecar(spec, "start")

console.log(
  `[desktop] mode=${plan.mode} auto_restart=${autoRestart} web=${webPort} backend=${backendPort} mongo=${mongoPort} sidecars=${plan.specs
    .map((spec) => spec.name)
    .join(",")}`
)
