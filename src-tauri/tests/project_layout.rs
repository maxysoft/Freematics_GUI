//! Integration test: assert the project layout expected by Phase 1 exists.
//!
//! Runs inside the dev container. Paths resolve relative to the workspace
//! root (parent of `src-tauri`) via `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a parent workspace dir")
        .to_path_buf()
}

fn exists(rel: &str) -> bool {
    workspace_root().join(rel).exists()
}

#[test]
fn src_tauri_main_exists() {
    assert!(exists("src-tauri/src/main.rs"), "src-tauri/src/main.rs missing");
}

#[test]
fn src_tauri_cargo_toml_exists() {
    assert!(exists("src-tauri/Cargo.toml"), "src-tauri/Cargo.toml missing");
}

#[test]
fn package_json_exists() {
    assert!(exists("package.json"), "package.json missing");
}

#[test]
fn dockerfile_exists() {
    assert!(exists("Dockerfile"), "Dockerfile missing");
}

#[test]
fn docker_compose_exists() {
    assert!(exists("docker-compose.yml"), "docker-compose.yml missing");
}

#[test]
fn index_html_exists() {
    assert!(exists("index.html"), "index.html missing");
}

#[test]
fn src_main_ts_exists() {
    assert!(exists("src/main.ts"), "src/main.ts missing");
}

#[test]
fn release_workflow_exists() {
    assert!(
        exists(".github/workflows/release.yml"),
        ".github/workflows/release.yml missing"
    );
}
