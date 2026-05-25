//! `.mono` name validation + U-curve price estimation.
//!
//! Spec from `memory/v4-naming-registry-locked.md` and whitepaper v4.1 §22.8.
//! Address allocation: precompile `0x110E` per Law §5.4. **This file is
//! validation only** — actual registration goes through the chain RPC,
//! which is not wired yet. See TODO.md → §1.5 Name registration.
//!
//! TLD categories (all five for completeness, even though v1 wallet
//! onboarding only registers human names):
//!
//! | Form                         | Category | Base multiplier |
//! |------------------------------|----------|-----------------|
//! | `<label>.mono`               | Human    | 5×              |
//! | `<label>.agent.<human>.mono` | Agent    | 2×              |
//! | `<label>.cluster.mono`       | Cluster  | 20×             |
//! | `<label>.contract.mono`      | Contract | 10×             |
//! | `<label>.system.mono`        | System   | (foundation)    |
//!
//! Length modifier (U-curve, applied to the *primary label*):
//!
//! | Length      | Multiplier |
//! |-------------|------------|
//! | 1 char      | 100×       |
//! | 2 chars     | 50×        |
//! | 3 chars     | 10×        |
//! | 4 chars     | 5×         |
//! | 5 chars     | 3×         |
//! | 6–12 chars  | 1×         |
//! | 13–20 chars | 1.5×       |
//! | 21–32 chars | 3×         |
//! | 33–50 chars | 10×        |
//! | 51–63 chars | 50×        |
//! | 64+         | forbidden  |
//!
//! Reserved-prefix list (extended 2026-05-17 by ADR-0038): forbid any label
//! beginning with a bech32m HRP followed by `1` to prevent visual address
//! impersonation. Plus the legacy `0x` defense.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Normal-tx base fee in LYTH (display unit, not wei). The chain returns
/// the live base fee per epoch — for now this is a placeholder so the
/// onboarding UI shows a plausible number.
///
/// TODO(name-base-fee): replace with live `eth_gasPrice` × estimated gas
/// for a name-register tx once the RPC client is wired.
const PLACEHOLDER_BASE_FEE_LYTH: f64 = 0.05;

const STRUCTURAL_RESERVES: &[&str] = &["agent", "cluster", "contract", "system"];

/// Bech32m HRP-then-`1` prefixes that would visually impersonate a typed
/// address. From ADR-0038 — covers allocated + reserved HRPs.
const VISUAL_IMPERSONATION_PREFIXES: &[&str] = &[
    "mono1", "monos1", "monoc1", "monok1", "monom1", "monox1", "monor1", "monop1", "monoi1",
    "monoa1",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NameCategory {
    Human,
    Agent,
    Cluster,
    Contract,
    System,
}

impl NameCategory {
    fn base_multiplier(self) -> Option<f64> {
        match self {
            NameCategory::Human => Some(5.0),
            NameCategory::Agent => Some(2.0),
            NameCategory::Cluster => Some(20.0),
            NameCategory::Contract => Some(10.0),
            NameCategory::System => None, // Foundation-only.
        }
    }
}

#[derive(Debug, Error, Serialize, Deserialize, Clone)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum NameError {
    #[error("name is empty")]
    Empty,
    #[error("label too long (max 63 chars)")]
    LabelTooLong,
    #[error("whole name too long (max 80 chars)")]
    WholeTooLong,
    #[error("invalid character — only lowercase letters, digits, and hyphens are allowed")]
    InvalidCharset,
    #[error("hyphens cannot be at the start or end of a label")]
    HyphenEdge,
    #[error("consecutive hyphens are not allowed")]
    ConsecutiveHyphens,
    #[error("`{label}` is reserved for the {kind} TLD category")]
    StructuralReserve { label: String, kind: String },
    #[error(
        "names beginning with `{prefix}` are forbidden — they would visually impersonate a wallet address"
    )]
    VisualImpersonation { prefix: String },
    #[error("hex-style `0x` prefix is reserved")]
    HexPrefix,
    #[error("System (`*.system.mono`) names can only be registered by the Foundation")]
    SystemReserved,
    #[error("invalid name shape: {message}")]
    Shape { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct NameAvailability {
    pub name: String,
    pub category: NameCategory,
    pub primary_label: String,
    pub primary_label_len: usize,
    /// Whole-name byte length.
    pub whole_len: usize,
    /// Computed price in LYTH (display unit). None for System names.
    pub price_lyth: Option<String>,
    /// Length multiplier applied (U-curve).
    pub length_multiplier: f64,
    /// Category multiplier applied.
    pub category_multiplier: Option<f64>,
    /// `false` until live on-chain check lands — see TODO.md → §1.5.
    pub on_chain_check_performed: bool,
}

/// Parse a name and detect its category. The whitepaper allows
/// agent-nesting depth of exactly 1.
fn detect_category(name: &str) -> Result<(NameCategory, String), NameError> {
    let parts: Vec<&str> = name.split('.').collect();
    match parts.as_slice() {
        [_label] => Err(NameError::Shape {
            message: "name must end in .mono".into(),
        }),
        [label, "mono"] => Ok((NameCategory::Human, (*label).to_string())),
        [label, "cluster", "mono"] => Ok((NameCategory::Cluster, (*label).to_string())),
        [label, "contract", "mono"] => Ok((NameCategory::Contract, (*label).to_string())),
        [label, "system", "mono"] => Ok((NameCategory::System, (*label).to_string())),
        [label, "agent", _human, "mono"] => Ok((NameCategory::Agent, (*label).to_string())),
        _ => Err(NameError::Shape {
            message: format!("name `{name}` does not match a known TLD form"),
        }),
    }
}

fn validate_label(label: &str) -> Result<(), NameError> {
    if label.is_empty() {
        return Err(NameError::Empty);
    }
    if label.len() > 63 {
        return Err(NameError::LabelTooLong);
    }
    if label.starts_with('-') || label.ends_with('-') {
        return Err(NameError::HyphenEdge);
    }
    if label.contains("--") {
        return Err(NameError::ConsecutiveHyphens);
    }
    for c in label.chars() {
        let ok = matches!(c, 'a'..='z' | '0'..='9' | '-');
        if !ok {
            return Err(NameError::InvalidCharset);
        }
    }
    Ok(())
}

fn check_reserves(primary_label: &str, category: NameCategory) -> Result<(), NameError> {
    // Visual-impersonation reserves (block as primary label).
    if primary_label.starts_with("0x") {
        return Err(NameError::HexPrefix);
    }
    for prefix in VISUAL_IMPERSONATION_PREFIXES {
        if primary_label.starts_with(prefix) {
            return Err(NameError::VisualImpersonation {
                prefix: (*prefix).to_string(),
            });
        }
    }

    // Structural reserves: cannot be registered as a primary `*.mono` name.
    if category == NameCategory::Human && STRUCTURAL_RESERVES.contains(&primary_label) {
        let kind = match primary_label {
            "agent" => "agent",
            "cluster" => "cluster",
            "contract" => "contract",
            "system" => "system",
            _ => "structural",
        };
        return Err(NameError::StructuralReserve {
            label: primary_label.to_string(),
            kind: kind.to_string(),
        });
    }

    if category == NameCategory::System {
        return Err(NameError::SystemReserved);
    }

    Ok(())
}

fn length_multiplier(label_len: usize) -> f64 {
    match label_len {
        0 => f64::INFINITY,
        1 => 100.0,
        2 => 50.0,
        3 => 10.0,
        4 => 5.0,
        5 => 3.0,
        6..=12 => 1.0,
        13..=20 => 1.5,
        21..=32 => 3.0,
        33..=50 => 10.0,
        51..=63 => 50.0,
        _ => f64::INFINITY,
    }
}

/// Validate a name end-to-end and compute the estimated price. Does NOT
/// perform a live availability check yet — that requires the RPC client.
pub fn validate(name: &str) -> Result<NameAvailability, NameError> {
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > 80 {
        return Err(NameError::WholeTooLong);
    }

    let (category, primary_label) = detect_category(name)?;
    validate_label(&primary_label)?;
    // For nested agent names, ensure all intermediate labels are valid too.
    for piece in name.split('.') {
        if piece == "mono"
            || piece == "agent"
            || piece == "cluster"
            || piece == "contract"
            || piece == "system"
        {
            continue;
        }
        validate_label(piece)?;
    }
    check_reserves(&primary_label, category)?;

    let length_mult = length_multiplier(primary_label.len());
    let cat_mult = category.base_multiplier();

    let price_lyth = cat_mult.map(|cm| {
        let price = cm * length_mult * PLACEHOLDER_BASE_FEE_LYTH;
        // Two decimal places for display.
        format!("{price:.2}")
    });

    Ok(NameAvailability {
        name: name.to_string(),
        category,
        primary_label_len: primary_label.len(),
        primary_label,
        whole_len: name.len(),
        price_lyth,
        length_multiplier: length_mult,
        category_multiplier: cat_mult,
        on_chain_check_performed: false,
    })
}

/// Tauri command: validate a `.mono` name and estimate its registration
/// price. Pure client-side check — no chain RPC required. Use this in
/// Onboarding (when the user picks a name), Send (recipient autocomplete),
/// and Stele (provider profile lookup) before any signing flow.
#[tauri::command]
pub fn name_check_availability(name: String) -> Result<NameAvailability, NameError> {
    validate(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_human() {
        let a = validate("alice.mono").unwrap();
        assert_eq!(a.category, NameCategory::Human);
        assert_eq!(a.primary_label, "alice");
        assert_eq!(a.primary_label_len, 5);
        assert_eq!(a.length_multiplier, 3.0);
        assert_eq!(a.category_multiplier, Some(5.0));
        assert!(a.price_lyth.is_some());
    }

    #[test]
    fn happy_path_agent() {
        let a = validate("bot.agent.alice.mono").unwrap();
        assert_eq!(a.category, NameCategory::Agent);
        assert_eq!(a.primary_label, "bot");
    }

    #[test]
    fn rejects_visual_impersonation_mono1() {
        assert!(matches!(
            validate("mono1abc.mono"),
            Err(NameError::VisualImpersonation { .. })
        ));
    }

    #[test]
    fn rejects_visual_impersonation_monos1() {
        assert!(matches!(
            validate("monos1xyz.mono"),
            Err(NameError::VisualImpersonation { .. })
        ));
    }

    #[test]
    fn rejects_hex_prefix() {
        assert!(matches!(
            validate("0xdeadbeef.mono"),
            Err(NameError::HexPrefix)
        ));
    }

    #[test]
    fn rejects_structural_reserve_as_primary() {
        assert!(matches!(
            validate("agent.mono"),
            Err(NameError::StructuralReserve { .. })
        ));
    }

    #[test]
    fn rejects_system_category() {
        assert!(matches!(
            validate("bridge.system.mono"),
            Err(NameError::SystemReserved)
        ));
    }

    #[test]
    fn rejects_invalid_charset() {
        assert!(matches!(
            validate("Alice.mono"),
            Err(NameError::InvalidCharset)
        ));
        assert!(matches!(
            validate("alice_b.mono"),
            Err(NameError::InvalidCharset)
        ));
    }

    #[test]
    fn rejects_hyphen_edges() {
        assert!(matches!(validate("-foo.mono"), Err(NameError::HyphenEdge)));
        assert!(matches!(validate("foo-.mono"), Err(NameError::HyphenEdge)));
    }

    #[test]
    fn rejects_consecutive_hyphens() {
        assert!(matches!(
            validate("foo--bar.mono"),
            Err(NameError::ConsecutiveHyphens)
        ));
    }

    #[test]
    fn price_curve_short_expensive() {
        let a = validate("a.mono").unwrap();
        let b = validate("alice12.mono").unwrap();
        let pa: f64 = a.price_lyth.unwrap().parse().unwrap();
        let pb: f64 = b.price_lyth.unwrap().parse().unwrap();
        assert!(pa > pb, "1-char should cost more than 7-char");
    }

    #[test]
    fn price_curve_long_expensive() {
        let sweet = validate("alicebob.mono").unwrap();
        let longish = validate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mono").unwrap();
        let sp: f64 = sweet.price_lyth.unwrap().parse().unwrap();
        let lp: f64 = longish.price_lyth.unwrap().parse().unwrap();
        assert!(lp > sp, "36-char should cost more than 8-char (sweet spot)");
    }
}
