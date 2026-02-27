# Desktop Runtime (Tauri + Sidecars)

This folder contains desktop-runtime scaffolding for a dual-mode deployment model:

- `local_fullstack`: desktop launches web + backend + local Mongo sidecars.
- `remote_slim`: desktop launches web only and points it to a remote backend.

Tauri shell scaffolding is under:

- `/Users/stgr/IdeaProjects/ProjectQaAssist/web/src-tauri/Cargo.toml`
- `/Users/stgr/IdeaProjects/ProjectQaAssist/web/src-tauri/tauri.conf.json`

## Runtime profile

- Schema: `/Users/stgr/IdeaProjects/ProjectQaAssist/desktop/runtime-profile.schema.json`
- Example: `/Users/stgr/IdeaProjects/ProjectQaAssist/desktop/runtime-profile.example.json`

The backend reads `RUNTIME_PROFILE_PATH` and combines values with env overrides.

## Backend launcher

Use `/Users/stgr/IdeaProjects/ProjectQaAssist/backend/scripts/run_backend.py` for desktop-style startup:

```bash
cd /Users/stgr/IdeaProjects/ProjectQaAssist/backend
python3 scripts/run_backend.py \
  --runtime-mode local_fullstack \
  --runtime-profile-path /absolute/path/runtime-profile.json \
  --host 127.0.0.1 --port 8080
```

CLI flags map to runtime env vars and take precedence over profile defaults.

## Web standalone launcher

Build first, then run:

```bash
cd /Users/stgr/IdeaProjects/ProjectQaAssist/web
npm run build
npm run start:standalone -- --runtime-profile /absolute/path/runtime-profile.json
```

The launcher sets `BACKEND_BASE_URL` from runtime mode:

- local mode -> `http://127.0.0.1:<backend_port>`
- remote mode -> `backend_url` from profile

Tauri scripts:

```bash
cd /Users/stgr/IdeaProjects/ProjectQaAssist/web
npm run desktop:dev
npm run desktop:build
```

## Notes

- Local services should bind to `127.0.0.1` only.
- `GET /runtime/info`, `GET /health/live`, and `GET /health/ready` are available for desktop sidecar health checks.
- Current implementation keeps Mongo as the active storage engine in both modes, with repository boundaries introduced incrementally.

## Sidecar orchestration helper

You can launch web/backend/mongo sidecars directly with:

```bash
cd /Users/stgr/IdeaProjects/ProjectQaAssist
node desktop/scripts/launch-desktop-runtime.mjs --profile /absolute/path/runtime-profile.json
```

Useful overrides:

- `--mode remote_slim` (or `local_fullstack`)
- `--web-dev` to run `next dev` instead of standalone web server
- `--no-auto-restart` to disable sidecar auto-recovery watchdog
- `MONGOD_BIN=/absolute/path/mongod` to launch local Mongo sidecar
- `PYTHON_BIN=/absolute/path/python3` to select backend Python runtime

The desktop runtime keeps a bounded restart budget (6 restarts within 90 seconds per sidecar). If the budget is exhausted, auto-restart is disabled for safety and the last error is surfaced in the Desktop Runtime dialog.

## Runtime diagnostics feed

In the desktop shell, runtime diagnostics are exposed through Tauri commands:

- `desktop_runtime_status`
- `desktop_runtime_diagnostics`

`desktop_runtime_diagnostics` returns a rolling event feed (start/stop, sidecar exits, restart attempts, recovery failures) that the chat runtime popup renders in the "Runtime events" panel.

Diagnostics are persisted to a local JSON file so history survives app restarts:

- Preferred location: `<data_dir>/runtime/runtime-events.json` (from runtime profile)
- Fallback location: `~/.project-qa-assistant/runtime/runtime-events.json`
