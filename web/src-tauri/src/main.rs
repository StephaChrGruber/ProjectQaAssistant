#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeMode {
    LocalFullstack,
    RemoteSlim,
}

impl RuntimeMode {
    fn from_raw(value: &str) -> Self {
        match value.trim() {
            "desktop_remote_slim" | "remote_slim" => Self::RemoteSlim,
            _ => Self::LocalFullstack,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::LocalFullstack => "local_fullstack",
            Self::RemoteSlim => "remote_slim",
        }
    }

    fn as_backend_runtime_mode(self) -> &'static str {
        match self {
            Self::LocalFullstack => "desktop_local_fullstack",
            Self::RemoteSlim => "desktop_remote_slim",
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LocalPorts {
    web: Option<u16>,
    backend: Option<u16>,
    mongo: Option<u16>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct RuntimeProfile {
    mode: Option<String>,
    backend_url: Option<String>,
    local_ports: Option<LocalPorts>,
    data_dir: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DesktopRuntimeStartRequest {
    mode: Option<String>,
    profile_path: Option<String>,
    web_dev: Option<bool>,
    mongo_bin: Option<String>,
    python_bin: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeLaunchConfig {
    mode: RuntimeMode,
    web_port: u16,
    backend_port: u16,
    mongo_port: u16,
    backend_url: String,
    desktop_session_id: String,
    runtime_profile_path: Option<String>,
    web_dev: bool,
    mongo_bin: Option<String>,
    python_bin: String,
    web_dir: PathBuf,
    backend_dir: PathBuf,
    data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct DesktopRuntimeStatus {
    running: bool,
    mode: String,
    web_pid: Option<u32>,
    backend_pid: Option<u32>,
    mongo_pid: Option<u32>,
    started_at_ms: Option<u64>,
    last_error: Option<String>,
    web_port: u16,
    backend_port: u16,
    mongo_port: u16,
    backend_url: String,
    auto_restart: bool,
    restart_count: u32,
    last_restart_ms: Option<u64>,
    diagnostics_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DesktopRuntimeDiagEvent {
    ts_ms: u64,
    level: String,
    source: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct DesktopRuntimeDiagnostics {
    generated_at_ms: u64,
    status: DesktopRuntimeStatus,
    events: Vec<DesktopRuntimeDiagEvent>,
}

#[derive(Debug)]
struct RuntimeProcessState {
    running: bool,
    mode: RuntimeMode,
    web: Option<Child>,
    backend: Option<Child>,
    mongo: Option<Child>,
    started_at_ms: Option<u64>,
    last_error: Option<String>,
    web_port: u16,
    backend_port: u16,
    mongo_port: u16,
    backend_url: String,
    auto_restart: bool,
    restart_count: u32,
    last_restart_ms: Option<u64>,
    launch_config: Option<RuntimeLaunchConfig>,
    events: Vec<DesktopRuntimeDiagEvent>,
    diagnostics_path: Option<PathBuf>,
}

impl Default for RuntimeProcessState {
    fn default() -> Self {
        Self {
            running: false,
            mode: RuntimeMode::LocalFullstack,
            web: None,
            backend: None,
            mongo: None,
            started_at_ms: None,
            last_error: None,
            web_port: 3000,
            backend_port: 8080,
            mongo_port: 27017,
            backend_url: "http://127.0.0.1:8080".to_string(),
            auto_restart: false,
            restart_count: 0,
            last_restart_ms: None,
            launch_config: None,
            events: Vec::new(),
            diagnostics_path: None,
        }
    }
}

#[derive(Default)]
struct DesktopRuntimeManager {
    state: Mutex<RuntimeProcessState>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn user_home_dir() -> Option<PathBuf> {
    if let Ok(raw) = env::var("HOME") {
        let clean = raw.trim();
        if !clean.is_empty() {
            return Some(PathBuf::from(clean));
        }
    }
    if let Ok(raw) = env::var("USERPROFILE") {
        let clean = raw.trim();
        if !clean.is_empty() {
            return Some(PathBuf::from(clean));
        }
    }
    None
}

fn expand_tilde_path(raw: &str) -> PathBuf {
    let text = raw.trim();
    if text == "~" {
        if let Some(home) = user_home_dir() {
            return home;
        }
    }
    if let Some(rest) = text.strip_prefix("~/") {
        if let Some(home) = user_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(text)
}

fn diagnostics_path_for_data_dir(data_dir_hint: Option<&str>) -> PathBuf {
    let root = match data_dir_hint {
        Some(raw) if !raw.trim().is_empty() => expand_tilde_path(raw),
        _ => {
            if let Some(home) = user_home_dir() {
                home.join(".project-qa-assistant")
            } else if let Ok(cwd) = env::current_dir() {
                cwd.join(".project-qa-assistant")
            } else {
                PathBuf::from(".project-qa-assistant")
            }
        }
    };
    root.join("runtime").join("runtime-events.json")
}

fn load_runtime_events_from_path(path: &Path) -> Vec<DesktopRuntimeDiagEvent> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut rows = match serde_json::from_str::<Vec<DesktopRuntimeDiagEvent>>(&raw) {
        Ok(list) => list,
        Err(_) => return Vec::new(),
    };
    const MAX_EVENTS: usize = 200;
    if rows.len() > MAX_EVENTS {
        let trim = rows.len().saturating_sub(MAX_EVENTS);
        rows.drain(0..trim);
    }
    rows
}

fn persist_runtime_events(state: &RuntimeProcessState) {
    let Some(path) = state.diagnostics_path.as_ref() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(payload) = serde_json::to_string(&state.events) {
        let _ = fs::write(path, payload);
    }
}

fn ensure_diagnostics_state(state: &mut RuntimeProcessState, data_dir_hint: Option<&str>) {
    let next_path = if let Some(raw) = data_dir_hint {
        if raw.trim().is_empty() {
            state
                .diagnostics_path
                .clone()
                .unwrap_or_else(|| diagnostics_path_for_data_dir(None))
        } else {
            diagnostics_path_for_data_dir(Some(raw))
        }
    } else {
        state
            .diagnostics_path
            .clone()
            .unwrap_or_else(|| diagnostics_path_for_data_dir(None))
    };
    let changed = state
        .diagnostics_path
        .as_ref()
        .map(|current| current != &next_path)
        .unwrap_or(true);
    if changed {
        let mut loaded = load_runtime_events_from_path(&next_path);
        if !state.events.is_empty() {
            loaded.extend(state.events.clone());
            const MAX_EVENTS: usize = 200;
            if loaded.len() > MAX_EVENTS {
                let trim = loaded.len().saturating_sub(MAX_EVENTS);
                loaded.drain(0..trim);
            }
        }
        state.events = loaded;
        state.diagnostics_path = Some(next_path);
        persist_runtime_events(state);
        return;
    }
    if state.events.is_empty() {
        if let Some(path) = state.diagnostics_path.as_ref() {
            state.events = load_runtime_events_from_path(path);
        }
    }
}

fn resolve_workspace_root() -> Result<PathBuf, String> {
    if let Ok(raw) = env::var("PQA_WORKSPACE_ROOT") {
        if let Some(path) = normalize_path(&raw) {
            return Ok(path);
        }
    }
    let from_manifest = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    Ok(from_manifest)
}

fn load_runtime_profile(profile_path: Option<&str>) -> RuntimeProfile {
    let Some(path) = profile_path.and_then(normalize_path) else {
        return RuntimeProfile::default();
    };
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<RuntimeProfile>(&raw).unwrap_or_default(),
        Err(_) => RuntimeProfile::default(),
    }
}

fn npm_bin() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn stop_child(child: &mut Option<Child>) {
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

fn push_runtime_event(state: &mut RuntimeProcessState, level: &str, source: &str, message: impl Into<String>) {
    ensure_diagnostics_state(state, None);
    let event = DesktopRuntimeDiagEvent {
        ts_ms: now_ms(),
        level: level.trim().to_lowercase(),
        source: source.trim().to_lowercase(),
        message: message.into(),
    };
    state.events.push(event);
    const MAX_EVENTS: usize = 200;
    if state.events.len() > MAX_EVENTS {
        let trim = state.events.len().saturating_sub(MAX_EVENTS);
        state.events.drain(0..trim);
    }
    persist_runtime_events(state);
}

fn clear_launch_state(state: &mut RuntimeProcessState) {
    state.auto_restart = false;
    state.restart_count = 0;
    state.last_restart_ms = None;
    state.launch_config = None;
}

fn stop_processes(state: &mut RuntimeProcessState) {
    stop_child(&mut state.web);
    stop_child(&mut state.backend);
    stop_child(&mut state.mongo);
    state.running = false;
}

fn stop_all(state: &mut RuntimeProcessState) {
    stop_processes(state);
    clear_launch_state(state);
}

fn is_backend_required(config: &RuntimeLaunchConfig) -> bool {
    config.mode == RuntimeMode::LocalFullstack
}

fn is_mongo_required(config: &RuntimeLaunchConfig) -> bool {
    config.mode == RuntimeMode::LocalFullstack && config.mongo_bin.is_some()
}

fn recompute_running(state: &RuntimeProcessState) -> bool {
    let Some(config) = state.launch_config.as_ref() else {
        return false;
    };
    if state.web.is_none() {
        return false;
    }
    if is_backend_required(config) && state.backend.is_none() {
        return false;
    }
    if is_mongo_required(config) && state.mongo.is_none() {
        return false;
    }
    true
}

fn spawn_mongo(config: &RuntimeLaunchConfig) -> Result<Option<Child>, String> {
    if config.mode != RuntimeMode::LocalFullstack {
        return Ok(None);
    }
    let Some(mongo_bin) = config.mongo_bin.as_ref() else {
        return Ok(None);
    };
    let mut mongo_cmd = Command::new(mongo_bin);
    mongo_cmd.arg("--port").arg(config.mongo_port.to_string());
    if let Some(dir) = config.data_dir.as_ref() {
        let db_dir = Path::new(dir).join("mongo");
        let _ = fs::create_dir_all(&db_dir);
        mongo_cmd.arg("--dbpath").arg(db_dir);
    }
    let child = mongo_cmd
        .spawn()
        .map_err(|err| format!("failed to start mongo sidecar: {err}"))?;
    Ok(Some(child))
}

fn spawn_backend(config: &RuntimeLaunchConfig) -> Result<Option<Child>, String> {
    if config.mode != RuntimeMode::LocalFullstack {
        return Ok(None);
    }
    let mut backend_cmd = Command::new(&config.python_bin);
    backend_cmd
        .current_dir(&config.backend_dir)
        .arg("scripts/run_backend.py")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(config.backend_port.to_string())
        .arg("--runtime-mode")
        .arg(config.mode.as_backend_runtime_mode())
        .env("APP_RUNTIME_MODE", config.mode.as_backend_runtime_mode())
        .env("APP_BACKEND_ORIGIN", "local")
        .env("DESKTOP_SESSION_ID", config.desktop_session_id.clone())
        .env("MONGODB_URI", format!("mongodb://127.0.0.1:{}", config.mongo_port));
    if let Some(profile_path) = config.runtime_profile_path.as_ref() {
        backend_cmd.env("RUNTIME_PROFILE_PATH", profile_path);
    }
    let child = backend_cmd
        .spawn()
        .map_err(|err| format!("failed to start backend sidecar: {err}"))?;
    Ok(Some(child))
}

fn spawn_web(config: &RuntimeLaunchConfig) -> Result<Child, String> {
    let mut web_cmd = Command::new(npm_bin());
    web_cmd
        .current_dir(&config.web_dir)
        .env("PORT", config.web_port.to_string())
        .env("BACKEND_BASE_URL", config.backend_url.clone())
        .env("APP_RUNTIME_MODE", config.mode.as_backend_runtime_mode())
        .env("DESKTOP_SESSION_ID", config.desktop_session_id.clone());
    if let Some(profile_path) = config.runtime_profile_path.as_ref() {
        web_cmd.env("RUNTIME_PROFILE_PATH", profile_path);
    }
    if config.web_dev {
        web_cmd.arg("run").arg("dev");
    } else {
        web_cmd.arg("run").arg("start:standalone");
        if let Some(profile_path) = config.runtime_profile_path.as_ref() {
            web_cmd.arg("--").arg("--runtime-profile").arg(profile_path);
        }
    }
    web_cmd
        .spawn()
        .map_err(|err| format!("failed to start web sidecar: {err}"))
}

fn describe_exit(name: &str, status: std::process::ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("{name} exited with code {code}");
    }
    format!("{name} exited")
}

fn poll_process_exits(state: &mut RuntimeProcessState) -> Vec<(&'static str, String)> {
    let mut exited: Vec<(&'static str, String)> = Vec::new();
    if let Some(child) = state.web.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                exited.push(("web", describe_exit("web", status)));
                state.web = None;
            }
            Ok(None) => {}
            Err(_) => {
                exited.push(("web", "web process status check failed".to_string()));
                state.web = None;
            }
        }
    }
    if let Some(child) = state.backend.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                exited.push(("backend", describe_exit("backend", status)));
                state.backend = None;
            }
            Ok(None) => {}
            Err(_) => {
                exited.push(("backend", "backend process status check failed".to_string()));
                state.backend = None;
            }
        }
    }
    if let Some(child) = state.mongo.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                exited.push(("mongo", describe_exit("mongo", status)));
                state.mongo = None;
            }
            Ok(None) => {}
            Err(_) => {
                exited.push(("mongo", "mongo process status check failed".to_string()));
                state.mongo = None;
            }
        }
    }
    exited
}

fn restart_missing_processes(state: &mut RuntimeProcessState) -> Result<Vec<&'static str>, String> {
    let Some(config) = state.launch_config.clone() else {
        return Ok(Vec::new());
    };
    let mut restarted: Vec<&'static str> = Vec::new();

    if state.web.is_none() {
        push_runtime_event(state, "warn", "watchdog", "Restarting web sidecar");
        state.web = Some(spawn_web(&config)?);
        if !wait_for_port(config.web_port, Duration::from_secs(30)) {
            state.web = None;
            return Err("web did not become ready after restart".to_string());
        }
        restarted.push("web");
    }

    if is_backend_required(&config) && state.backend.is_none() {
        push_runtime_event(state, "warn", "watchdog", "Restarting backend sidecar");
        state.backend = spawn_backend(&config)?;
        if !wait_for_port(config.backend_port, Duration::from_secs(30)) {
            state.backend = None;
            return Err("backend did not become ready after restart".to_string());
        }
        restarted.push("backend");
    }

    if is_mongo_required(&config) && state.mongo.is_none() {
        push_runtime_event(state, "warn", "watchdog", "Restarting mongo sidecar");
        state.mongo = spawn_mongo(&config)?;
        if state.mongo.is_some() {
            restarted.push("mongo");
        }
    }

    if !restarted.is_empty() {
        state.restart_count = state.restart_count.saturating_add(1);
        state.last_restart_ms = Some(now_ms());
        push_runtime_event(
            state,
            "info",
            "watchdog",
            format!("Recovered sidecars: {}", restarted.join(", ")),
        );
    }
    Ok(restarted)
}

fn reconcile_runtime_state(state: &mut RuntimeProcessState) {
    let exited = poll_process_exits(state);
    if !exited.is_empty() {
        let mut parts: Vec<String> = Vec::new();
        for (source, message) in &exited {
            push_runtime_event(state, "warn", source, message.clone());
            parts.push(message.clone());
        }
        state.last_error = Some(parts.join(" | "));
    }

    let should_attempt_restart = state.auto_restart && state.launch_config.is_some() && (!exited.is_empty() || !recompute_running(state));
    if should_attempt_restart {
        let now = now_ms();
        let recently_restarted = state
            .last_restart_ms
            .map(|last| now.saturating_sub(last) < 90_000)
            .unwrap_or(false);
        if recently_restarted && state.restart_count >= 6 {
            state.auto_restart = false;
            let message = "Auto-restart disabled after repeated sidecar failures".to_string();
            push_runtime_event(state, "error", "watchdog", message.clone());
            state.last_error = Some(message);
        } else if let Err(err) = restart_missing_processes(state) {
            let message = format!("Auto-restart failed: {err}");
            push_runtime_event(state, "error", "watchdog", message.clone());
            state.last_error = Some(message);
        }
    }

    state.running = recompute_running(state);
}

fn snapshot_status(state: &RuntimeProcessState) -> DesktopRuntimeStatus {
    DesktopRuntimeStatus {
        running: state.running,
        mode: state.mode.as_str().to_string(),
        web_pid: state.web.as_ref().map(|c| c.id()),
        backend_pid: state.backend.as_ref().map(|c| c.id()),
        mongo_pid: state.mongo.as_ref().map(|c| c.id()),
        started_at_ms: state.started_at_ms,
        last_error: state.last_error.clone(),
        web_port: state.web_port,
        backend_port: state.backend_port,
        mongo_port: state.mongo_port,
        backend_url: state.backend_url.clone(),
        auto_restart: state.auto_restart,
        restart_count: state.restart_count,
        last_restart_ms: state.last_restart_ms,
        diagnostics_path: state
            .diagnostics_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn desktop_runtime_status(manager: State<'_, DesktopRuntimeManager>) -> DesktopRuntimeStatus {
    let mut guard = manager.state.lock().expect("desktop runtime mutex poisoned");
    ensure_diagnostics_state(&mut guard, None);
    reconcile_runtime_state(&mut guard);
    snapshot_status(&guard)
}

#[tauri::command]
fn desktop_runtime_diagnostics(
    manager: State<'_, DesktopRuntimeManager>,
    limit: Option<u32>,
) -> DesktopRuntimeDiagnostics {
    let mut guard = manager.state.lock().expect("desktop runtime mutex poisoned");
    ensure_diagnostics_state(&mut guard, None);
    reconcile_runtime_state(&mut guard);
    let max = limit.unwrap_or(80).clamp(1, 300) as usize;
    let len = guard.events.len();
    let start = len.saturating_sub(max);
    DesktopRuntimeDiagnostics {
        generated_at_ms: now_ms(),
        status: snapshot_status(&guard),
        events: guard.events[start..].to_vec(),
    }
}

#[tauri::command]
fn desktop_runtime_stop(manager: State<'_, DesktopRuntimeManager>) -> Result<DesktopRuntimeStatus, String> {
    let mut guard = manager
        .state
        .lock()
        .map_err(|_| "desktop runtime mutex poisoned".to_string())?;
    push_runtime_event(&mut guard, "info", "runtime", "Stop requested");
    stop_all(&mut guard);
    guard.last_error = None;
    push_runtime_event(&mut guard, "info", "runtime", "Runtime stopped");
    Ok(snapshot_status(&guard))
}

#[tauri::command]
fn desktop_runtime_start(
    manager: State<'_, DesktopRuntimeManager>,
    request: Option<DesktopRuntimeStartRequest>,
) -> Result<DesktopRuntimeStatus, String> {
    let req = request.unwrap_or_default();
    let mut guard = manager
        .state
        .lock()
        .map_err(|_| "desktop runtime mutex poisoned".to_string())?;
    reconcile_runtime_state(&mut guard);
    if guard.running {
        push_runtime_event(&mut guard, "info", "runtime", "Start requested while already running");
        return Ok(snapshot_status(&guard));
    }

    let profile_path = req
        .profile_path
        .or_else(|| env::var("RUNTIME_PROFILE_PATH").ok())
        .unwrap_or_default();
    let profile = load_runtime_profile(Some(&profile_path));
    ensure_diagnostics_state(&mut guard, profile.data_dir.as_deref());

    let mode_raw = req
        .mode
        .clone()
        .or_else(|| env::var("APP_RUNTIME_MODE").ok())
        .or(profile.mode.clone())
        .unwrap_or_else(|| "local_fullstack".to_string());
    let mode = RuntimeMode::from_raw(&mode_raw);
    let ports = profile.local_ports.unwrap_or_default();
    let web_port = ports.web.unwrap_or(3000);
    let backend_port = ports.backend.unwrap_or(8080);
    let mongo_port = ports.mongo.unwrap_or(27017);
    let web_dev = req.web_dev.unwrap_or(false);

    let workspace_root = resolve_workspace_root()?;
    let web_dir = workspace_root.join("web");
    let backend_dir = workspace_root.join("backend");
    if !web_dir.exists() || !backend_dir.exists() {
        return Err(format!(
            "workspace root not valid: web={} backend={}",
            web_dir.display(),
            backend_dir.display()
        ));
    }

    let runtime_profile_for_env = if profile_path.trim().is_empty() {
        None
    } else {
        Some(profile_path.clone())
    };
    let backend_url = if mode == RuntimeMode::RemoteSlim {
        profile
            .backend_url
            .clone()
            .unwrap_or_else(|| "http://127.0.0.1:8080".to_string())
    } else {
        format!("http://127.0.0.1:{backend_port}")
    };
    let desktop_session_id = env::var("DESKTOP_SESSION_ID").unwrap_or_else(|_| format!("desktop-{}", now_ms()));
    let mongo_bin = req
        .mongo_bin
        .clone()
        .or_else(|| env::var("MONGOD_BIN").ok())
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
    let python_bin = req
        .python_bin
        .or_else(|| env::var("PYTHON_BIN").ok())
        .unwrap_or_else(|| "python3".to_string());

    let launch = RuntimeLaunchConfig {
        mode,
        web_port,
        backend_port,
        mongo_port,
        backend_url: backend_url.clone(),
        desktop_session_id: desktop_session_id.clone(),
        runtime_profile_path: runtime_profile_for_env.clone(),
        web_dev,
        mongo_bin,
        python_bin,
        web_dir,
        backend_dir,
        data_dir: profile.data_dir.clone(),
    };

    stop_processes(&mut guard);
    push_runtime_event(
        &mut guard,
        "info",
        "runtime",
        format!(
            "Start requested: mode={} web_port={} backend_port={} mongo_port={}",
            mode.as_str(),
            web_port,
            backend_port,
            mongo_port
        ),
    );
    guard.launch_config = Some(launch.clone());
    guard.auto_restart = true;
    guard.restart_count = 0;
    guard.last_restart_ms = None;

    if is_mongo_required(&launch) {
        guard.mongo = spawn_mongo(&launch)?;
    } else {
        guard.mongo = None;
    }

    if is_backend_required(&launch) {
        guard.backend = spawn_backend(&launch)?;
    } else {
        guard.backend = None;
    }

    guard.web = Some(spawn_web(&launch)?);

    let web_ok = wait_for_port(launch.web_port, Duration::from_secs(35));
    let backend_ok = if is_backend_required(&launch) {
        wait_for_port(launch.backend_port, Duration::from_secs(35))
    } else {
        true
    };
    if !web_ok || !backend_ok {
        stop_all(&mut guard);
        let reason = if !web_ok && !backend_ok {
            "web and backend did not become ready in time"
        } else if !web_ok {
            "web did not become ready in time"
        } else {
            "backend did not become ready in time"
        };
        push_runtime_event(&mut guard, "error", "runtime", reason.to_string());
        guard.last_error = Some(reason.to_string());
        return Err(reason.to_string());
    }

    guard.running = true;
    guard.mode = mode;
    guard.started_at_ms = Some(now_ms());
    guard.last_error = None;
    guard.web_port = web_port;
    guard.backend_port = backend_port;
    guard.mongo_port = mongo_port;
    guard.backend_url = backend_url;
    push_runtime_event(
        &mut guard,
        "info",
        "runtime",
        "Runtime started successfully".to_string(),
    );

    Ok(snapshot_status(&guard))
}

fn main() {
    tauri::Builder::default()
        .manage(DesktopRuntimeManager::default())
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            desktop_runtime_diagnostics,
            desktop_runtime_start,
            desktop_runtime_stop
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Project QA desktop shell");
}
