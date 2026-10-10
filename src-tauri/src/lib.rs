mod convert;
mod profile;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use convert::{TagInfo, Table};
use profile::{Profile, BUILTIN_ID};

type CmdResult<T> = Result<T, String>;

fn profiles_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Priečinok s profilmi sa nedá vytvoriť: {e}"))?;
    Ok(dir)
}

fn profile_file(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Neplatné ID profilu.".into());
    }
    Ok(profiles_dir(app)?.join(format!("{id}.json")))
}

fn new_id() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("p-{ms}")
}

fn parse_profile(text: &str) -> CmdResult<Profile> {
    let p: Profile = serde_json::from_str(text).map_err(|e| format!("Neplatný súbor profilu: {e}"))?;
    p.validate()?;
    Ok(p)
}

fn write_profile(app: &AppHandle, p: &Profile) -> CmdResult<()> {
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(profile_file(app, &p.id)?, json).map_err(|e| format!("Profil sa nedá uložiť: {e}"))
}

#[tauri::command]
fn list_profiles(app: AppHandle) -> CmdResult<Vec<Profile>> {
    let mut list = Vec::new();
    for entry in std::fs::read_dir(profiles_dir(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|e| e == "json") {
            // Poškodený súbor profilu len preskočíme, aby nezablokoval aplikáciu.
            if let Ok(mut p) = std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| parse_profile(&t)) {
                p.builtin = false;
                list.push(p);
            }
        }
    }
    list.sort_by_key(|p| p.name.to_lowercase());
    list.insert(0, profile::builtin());
    Ok(list)
}

/// Uloží profil. Vstavaný profil sa nikdy neprepíše – uloží sa ako nový.
#[tauri::command]
fn save_profile(app: AppHandle, mut profile: Profile) -> CmdResult<Profile> {
    profile.validate()?;
    if profile.builtin || profile.id.is_empty() || profile.id == BUILTIN_ID {
        profile.id = new_id();
    }
    profile.builtin = false;
    write_profile(&app, &profile)?;
    Ok(profile)
}

#[tauri::command]
fn delete_profile(app: AppHandle, id: String) -> CmdResult<()> {
    if id == BUILTIN_ID {
        return Err("Vstavaný profil sa nedá zmazať.".into());
    }
    std::fs::remove_file(profile_file(&app, &id)?).map_err(|e| format!("Profil sa nedá zmazať: {e}"))
}

#[tauri::command]
fn export_profile(mut profile: Profile, path: String) -> CmdResult<()> {
    profile.validate()?;
    profile.builtin = false;
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("Profil sa nedá exportovať: {e}"))
}

#[tauri::command]
fn import_profile(app: AppHandle, path: String) -> CmdResult<Profile> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Súbor sa nedá načítať: {e}"))?;
    let mut p = parse_profile(&text)?;
    p.id = new_id();
    p.builtin = false;
    write_profile(&app, &p)?;
    Ok(p)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Inspection {
    points: usize,
    tags: Vec<TagInfo>,
}

#[tauri::command]
async fn inspect_xml(path: String) -> CmdResult<Inspection> {
    let m = convert::read_measurement(Path::new(&path))?;
    let tags = m.tags.iter().map(|(t, u)| TagInfo { tag: t.clone(), units: u.clone() }).collect();
    Ok(Inspection { points: m.points.len(), tags })
}

#[tauri::command]
async fn preview(path: String, profile: Profile, rows: usize) -> CmdResult<Table> {
    let m = convert::read_measurement(Path::new(&path))?;
    Ok(convert::build_table(&m, &profile, Some(rows)))
}

#[tauri::command]
fn output_path(input: String, profile: Profile, dir: Option<String>) -> String {
    convert::output_path(Path::new(&input), &profile, dir.as_deref().map(Path::new))
        .to_string_lossy()
        .into_owned()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvertResult {
    output: String,
    rows: usize,
    skipped: usize,
    missing: usize,
    unused_tags: Vec<TagInfo>,
}

#[tauri::command]
async fn convert(input: String, output: String, profile: Profile) -> CmdResult<ConvertResult> {
    profile.validate()?;
    let m = convert::read_measurement(Path::new(&input))?;
    let table = convert::build_table(&m, &profile, None);
    let bytes = convert::to_csv(&table)?;
    std::fs::write(&output, bytes).map_err(|e| format!("CSV sa nedá zapísať (nie je otvorené v Exceli?): {e}"))?;
    Ok(ConvertResult {
        output,
        rows: table.rows.len(),
        skipped: table.skipped,
        missing: table.missing,
        unused_tags: convert::unused_tags(&m, &profile),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            export_profile,
            import_profile,
            inspect_xml,
            preview,
            output_path,
            convert,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
