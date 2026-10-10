use serde::{Deserialize, Serialize};

pub const BUILTIN_ID: &str = "mpx";
const BUILTIN_JSON: &str = include_str!("../profiles/mpx.json");

/// Kompletny popis, ako sa z XML vytvori CSV.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Vstavany profil sa neda prepisat ani zmazat.
    #[serde(default)]
    pub builtin: bool,
    /// Kolko prvych meracich bodov (CPOINT) preskocit.
    #[serde(default)]
    pub skip: usize,
    /// Vzor nazvu vystupneho suboru, `{nazov}` = nazov XML bez pripony.
    pub file_name: String,
    pub columns: Vec<Column>,
    /// Veliciny z XML, ktore sa zamerne nezapisuju (neukazuju sa ako "nove").
    #[serde(default)]
    pub ignored_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    #[serde(default)]
    pub unit: String,
    pub source: Source,
    /// hodnota = povodna * multiply + offset
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub multiply: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub offset: f64,
    /// Zapisat ako tri stlpce `(Min)`, `(Average)`, `(Max)`.
    #[serde(default)]
    pub triple: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Source {
    Date,
    Time,
    Measure { tag: String },
    Constant { value: String },
}

fn one() -> f64 {
    1.0
}

fn is_one(v: &f64) -> bool {
    *v == 1.0
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

pub fn builtin() -> Profile {
    let mut p: Profile = serde_json::from_str(BUILTIN_JSON).expect("profiles/mpx.json je neplatny");
    p.id = BUILTIN_ID.into();
    p.builtin = true;
    p
}

impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Profil musí mať názov.".into());
        }
        if self.columns.is_empty() {
            return Err("Profil musí mať aspoň jeden stĺpec.".into());
        }
        if self.file_name.trim().is_empty() {
            return Err("Názov výstupného súboru nesmie byť prázdny.".into());
        }
        for (i, c) in self.columns.iter().enumerate() {
            if c.name.trim().is_empty() {
                return Err(format!("Stĺpec č. {} nemá názov.", i + 1));
            }
            if let Source::Measure { tag } = &c.source {
                if tag.trim().is_empty() {
                    return Err(format!("Stĺpec „{}“ nemá zvolenú veličinu.", c.name));
                }
            }
            if !c.multiply.is_finite() || !c.offset.is_finite() {
                return Err(format!("Stĺpec „{}“ má neplatný prevod.", c.name));
            }
        }
        Ok(())
    }

    pub fn used_tags(&self) -> impl Iterator<Item = &str> {
        self.columns.iter().filter_map(|c| match &c.source {
            Source::Measure { tag } => Some(tag.as_str()),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_is_valid() {
        let p = builtin();
        assert!(p.builtin);
        assert_eq!(p.skip, 10);
        p.validate().unwrap();
    }
}
