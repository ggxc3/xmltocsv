use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::profile::{Profile, Source};

const STATS: [&str; 3] = ["Min", "Average", "Max"];

/// Jeden merací bod (`<CPOINT>`) z XML.
pub struct Point {
    date: String,
    time: String,
    measures: HashMap<String, String>,
}

pub struct Measurement {
    pub points: Vec<Point>,
    /// Vsetky veliciny najdene v XML a ich jednotky (v poradi podla nazvu).
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub tag: String,
    pub units: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub header: Vec<String>,
    pub units: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// Pocet bodov v XML (pred preskocenim).
    pub total_points: usize,
    pub skipped: usize,
    /// Pocet buniek, pre ktore v XML chybala hodnota.
    pub missing: usize,
}

pub fn read_measurement(path: &Path) -> Result<Measurement, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Súbor sa nedá načítať: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    parse_measurement(&text)
}

pub fn parse_measurement(text: &str) -> Result<Measurement, String> {
    let doc = roxmltree::Document::parse(text).map_err(|e| format!("Neplatné XML: {e}"))?;
    let mut points = Vec::new();
    let mut tags = BTreeMap::new();

    for cp in doc.root_element().children().filter(|n| n.has_tag_name("CPOINT")) {
        let mut measures = HashMap::new();
        if let Some(ms) = cp.children().find(|n| n.has_tag_name("MEASURES")) {
            for m in ms.children().filter(|n| n.is_element()) {
                let tag = m.tag_name().name().to_string();
                if let Some(v) = m.attribute("value") {
                    measures.insert(tag.clone(), v.to_string());
                }
                tags.entry(tag).or_insert_with(|| m.attribute("units").unwrap_or("").to_string());
            }
        }
        points.push(Point {
            date: cp.attribute("date").unwrap_or("").to_string(),
            time: cp.attribute("time").unwrap_or("").to_string(),
            measures,
        });
    }

    if points.is_empty() {
        return Err("V XML sa nenašli žiadne meracie body (CPOINT).".into());
    }
    Ok(Measurement { points, tags })
}

/// Zostavi tabulku podla profilu. `limit` obmedzi pocet riadkov (pre nahlad).
pub fn build_table(m: &Measurement, profile: &Profile, limit: Option<usize>) -> Table {
    let mut header = Vec::new();
    let mut units = Vec::new();
    for c in &profile.columns {
        if c.triple {
            for s in STATS {
                header.push(format!("{} ({s})", c.name));
                units.push(c.unit.clone());
            }
        } else {
            header.push(c.name.clone());
            units.push(c.unit.clone());
        }
    }

    let skipped = profile.skip.min(m.points.len());
    let take = limit.unwrap_or(usize::MAX);
    let mut missing = 0;
    let mut rows = Vec::new();

    for p in m.points.iter().skip(skipped).take(take) {
        let mut row = Vec::with_capacity(header.len());
        for c in &profile.columns {
            let value = match &c.source {
                Source::Date => format_date(&p.date),
                Source::Time => p.time.clone(),
                Source::Constant { value } => value.clone(),
                Source::Measure { tag } => match p.measures.get(tag) {
                    Some(raw) => match raw.trim().parse::<f64>() {
                        Ok(v) => py_float(transform(v, c.multiply, c.offset)),
                        // Nečíselnú hodnotu (napr. "---") necháme tak, ako je.
                        Err(_) => raw.clone(),
                    },
                    None => {
                        missing += 1;
                        String::new()
                    }
                },
            };
            let n = if c.triple { STATS.len() } else { 1 };
            for _ in 0..n {
                row.push(value.clone());
            }
        }
        rows.push(row);
    }

    Table { header, units, rows, total_points: m.points.len(), skipped, missing }
}

/// Násobok a posun sa aplikujú iba ak menia hodnotu, aby výsledok
/// zostal bit po bite rovnaký ako v pôvodnom programe (napr. -0.0).
fn transform(v: f64, multiply: f64, offset: f64) -> f64 {
    let mut v = v;
    if multiply != 1.0 {
        v *= multiply;
    }
    if offset != 0.0 {
        v += offset;
    }
    v
}

/// Formát čísla ako Python `repr(float)` – tak ho zapisoval pôvodný program.
pub fn py_float(v: f64) -> String {
    let s = format!("{v:?}");
    match s.find('e') {
        Some(pos) => {
            let (mantissa, exp) = (&s[..pos], &s[pos + 1..]);
            let exp: i32 = exp.parse().unwrap_or(0);
            let sign = if exp < 0 { '-' } else { '+' };
            format!("{mantissa}e{sign}{:02}", exp.abs())
        }
        None => s,
    }
}

/// `2026-04-22` -> `22.04.2026`
fn format_date(d: &str) -> String {
    let parts: Vec<&str> = d.split('-').collect();
    match parts.as_slice() {
        [y, m, dd] => format!("{dd}.{m}.{y}"),
        _ => d.to_string(),
    }
}

pub fn to_csv(table: &Table) -> Result<Vec<u8>, String> {
    let mut w = csv::WriterBuilder::new()
        .terminator(csv::Terminator::CRLF)
        .from_writer(Vec::new());
    w.write_record(&table.header).map_err(|e| e.to_string())?;
    w.write_record(&table.units).map_err(|e| e.to_string())?;
    for r in &table.rows {
        w.write_record(r).map_err(|e| e.to_string())?;
    }
    w.into_inner().map_err(|e| e.to_string())
}

/// Veliciny z XML, ktore profil nepouziva ani neignoruje.
pub fn unused_tags(m: &Measurement, profile: &Profile) -> Vec<TagInfo> {
    let used: Vec<&str> = profile.used_tags().collect();
    m.tags
        .iter()
        .filter(|(t, _)| !used.contains(&t.as_str()) && !profile.ignored_tags.contains(t))
        .map(|(t, u)| TagInfo { tag: t.clone(), units: u.clone() })
        .collect()
}

pub fn output_path(input: &Path, profile: &Profile, dir: Option<&Path>) -> PathBuf {
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut name = profile.file_name.replace("{nazov}", &stem);
    if !name.to_lowercase().ends_with(".csv") {
        name.push_str(".csv");
    }
    let dir = dir.or_else(|| input.parent()).unwrap_or(Path::new(""));
    dir.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::builtin;

    const XML: &str = include_str!("../tests/fixtures/Jedynka.XML");
    const ORIGINAL_CSV: &[u8] = include_bytes!("../tests/fixtures/MeranieMPX_Jedynka.csv");

    #[test]
    fn reproduces_original_program_output() {
        // Pôvodný program nemal AM Depth – bez neho musí byť výstup identický.
        let mut p = builtin();
        p.columns.retain(|c| c.name != "AM Depth");
        let m = parse_measurement(XML).unwrap();
        let csv = to_csv(&build_table(&m, &p, None)).unwrap();
        assert!(csv == ORIGINAL_CSV, "výstup sa líši od pôvodného CSV");
    }

    #[test]
    fn builtin_adds_am_depth() {
        let m = parse_measurement(XML).unwrap();
        let t = build_table(&m, &builtin(), None);
        assert_eq!(t.rows.len(), 642);
        assert_eq!(t.skipped, 10);
        assert_eq!(t.missing, 0);
        let i = t.header.iter().position(|h| h == "AM Depth (Min)").unwrap();
        assert_eq!(t.header[i + 3], "GPS Longitude");
        assert_eq!(t.units[i], "%");
        // bod id=11 má AMDEPTH 10.3
        assert_eq!(&t.rows[0][i..i + 3], ["10.3", "10.3", "10.3"]);
    }

    #[test]
    fn builtin_reports_no_unused_tags() {
        let m = parse_measurement(XML).unwrap();
        assert!(unused_tags(&m, &builtin()).is_empty());
        let mut p = builtin();
        p.columns.retain(|c| c.name != "AM Depth");
        let unused = unused_tags(&m, &p);
        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].tag, "AMDEPTH");
        assert_eq!(unused[0].units, "%");
    }

    #[test]
    fn preview_limit() {
        let m = parse_measurement(XML).unwrap();
        assert_eq!(build_table(&m, &builtin(), Some(3)).rows.len(), 3);
    }

    #[test]
    fn python_float_format() {
        assert_eq!(py_float(66100.0), "66100.0");
        assert_eq!(py_float(64.9 * 1000.0), "64900.00000000001");
        assert_eq!(py_float(74.9 - 107.0), "-32.099999999999994");
        assert_eq!(py_float(-0.0), "-0.0");
        assert_eq!(py_float(1e16), "1e+16");
        assert_eq!(py_float(1.5e-5), "1.5e-05");
        assert_eq!(py_float(0.0001), "0.0001");
    }

    #[test]
    fn output_name() {
        let p = builtin();
        let out = output_path(Path::new("/a/b/Jedynka.XML"), &p, None);
        assert_eq!(out, Path::new("/a/b/MeranieMPX_Jedynka.csv"));
        let out = output_path(Path::new("/a/b/Jedynka.XML"), &p, Some(Path::new("/c")));
        assert_eq!(out, Path::new("/c/MeranieMPX_Jedynka.csv"));
    }
}
