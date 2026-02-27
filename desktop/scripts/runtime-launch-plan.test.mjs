import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"

import { buildLaunchPlan, normalizedMode } from "./runtime-launch-plan.mjs"

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"

test("normalizedMode maps aliases and defaults safely", () => {
  assert.equal(normalizedMode("local_fullstack"), "local_fullstack")
  assert.equal(normalizedMode("desktop_local_fullstack"), "local_fullstack")
  assert.equal(normalizedMode("remote_slim"), "remote_slim")
  assert.equal(normalizedMode("desktop_remote_slim"), "remote_slim")
  assert.equal(normalizedMode(""), "local_fullstack")
  assert.equal(normalizedMode("unknown"), "local_fullstack")
})

test("buildLaunchPlan creates mongo+backend+web for local fullstack", () => {
  const out = buildLaunchPlan({
    mode: "local_fullstack",
    workspaceRoot: "/tmp/workspace",
    webPort: 3111,
    backendPort: 8111,
    mongoPort: 27111,
    backendUrl: "http://127.0.0.1:8111",
    profilePath: "/tmp/runtime-profile.json",
    desktopSessionId: "session-1",
    webDev: false,
    mongoBin: "/usr/local/bin/mongod",
    pythonBin: "/usr/bin/python3",
    dataDir: "/tmp/pqa",
  })

  assert.equal(out.mode, "local_fullstack")
  assert.equal(out.specs.length, 3)
  assert.deepEqual(
    out.specs.map((row) => row.name),
    ["mongo", "backend", "web"]
  )

  const mongo = out.specs[0]
  assert.equal(mongo.cmd, "/usr/local/bin/mongod")
  assert.deepEqual(mongo.args, ["--port", "27111", "--dbpath", "/tmp/pqa/mongo"])

  const backend = out.specs[1]
  assert.equal(backend.cmd, "/usr/bin/python3")
  assert.equal(backend.cwd, path.join("/tmp/workspace", "backend"))
  assert.equal(backend.env.APP_RUNTIME_MODE, "desktop_local_fullstack")
  assert.equal(backend.env.MONGODB_URI, "mongodb://127.0.0.1:27111")
  assert.equal(backend.env.RUNTIME_PROFILE_PATH, "/tmp/runtime-profile.json")

  const web = out.specs[2]
  assert.equal(web.cmd, npmCmd)
  assert.equal(web.cwd, path.join("/tmp/workspace", "web"))
  assert.deepEqual(web.args, ["run", "start:standalone", "--", "--runtime-profile", "/tmp/runtime-profile.json"])
  assert.equal(web.env.PORT, "3111")
  assert.equal(web.env.BACKEND_BASE_URL, "http://127.0.0.1:8111")
  assert.equal(web.env.APP_RUNTIME_MODE, "desktop_local_fullstack")
})

test("buildLaunchPlan creates web-only plan for remote slim", () => {
  const out = buildLaunchPlan({
    mode: "remote_slim",
    workspaceRoot: "/tmp/workspace",
    webPort: 3222,
    backendPort: 8222,
    mongoPort: 27222,
    backendUrl: "https://qa.example.com",
    profilePath: "",
    desktopSessionId: "session-2",
    webDev: true,
    mongoBin: "",
    pythonBin: "python3",
    dataDir: "",
  })

  assert.equal(out.mode, "remote_slim")
  assert.equal(out.specs.length, 1)
  const web = out.specs[0]
  assert.equal(web.name, "web")
  assert.equal(web.cmd, npmCmd)
  assert.deepEqual(web.args, ["run", "dev"])
  assert.equal(web.env.BACKEND_BASE_URL, "https://qa.example.com")
  assert.equal(web.env.APP_RUNTIME_MODE, "desktop_remote_slim")
})
