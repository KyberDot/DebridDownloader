use super::ScraperError;
use serde::de::{self, Visitor};
use std::fmt;

/// Common public trackers appended to magnet links.
pub const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969",
    "udp://open.demonii.si:1337/announce",
];

// ── Flexible serde deserializer ──────────────────────────────────────

/// Deserializes a JSON value that is either a string or a number into a `String`.
/// Used to handle APIs that may return numeric fields as either `"42"` or `42`.
pub fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct StringOrNumber;

    impl<'de> Visitor<'de> for StringOrNumber {
        type Value = String;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string or a number")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
            Ok(v)
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_f64<E: de::Error>(self, v: f64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_unit<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }

        fn visit_none<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }
    }

    deserializer.deserialize_any(StringOrNumber)
}

// ── Magnet link construction ─────────────────────────────────────────

/// Build a magnet URI from an info hash and display name, with common public trackers.
pub fn build_magnet(info_hash: &str, name: &str) -> String {
    let encoded_name = urlencoding::encode(name);
    let trackers: String = TRACKERS
        .iter()
        .map(|t| format!("&tr={}", urlencoding::encode(t)))
        .collect();
    format!(
        "magnet:?xt=urn:btih:{}&dn={}{}",
        info_hash, encoded_name, trackers
    )
}

// ── Size formatting ──────────────────────────────────────────────────

/// Format a byte count into a human-readable string (e.g., "1.5 GB").
pub fn format_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 {
        return "0 B".to_string();
    }
    let exp = (bytes as f64).log(1024.0).floor() as usize;
    let exp = exp.min(UNITS.len() - 1);
    let size = bytes as f64 / 1024_f64.powi(exp as i32);
    format!("{:.1} {}", size, UNITS[exp])
}

// ── Torrent file → info hash extraction ──────────────────────────────

/// Download a `.torrent` file from `url`, parse the bencoded content,
/// SHA1-hash the raw `info` dictionary bytes, and return the 40-char hex info hash.
pub async fn extract_info_hash_from_torrent(
    url: &str,
    client: &reqwest::Client,
) -> Result<String, ScraperError> {
    let bytes = client
        .get(url)
        .send()
        .await?
        .bytes()
        .await?;

    extract_info_hash_from_bytes(&bytes)
}

/// Extract the info hash from raw bencoded `.torrent` bytes.
fn extract_info_hash_from_bytes(data: &[u8]) -> Result<String, ScraperError> {
    let info_key = b"4:info";
    let info_pos = data
        .windows(info_key.len())
        .position(|w| w == info_key)
        .ok_or_else(|| ScraperError::ParseError("No 'info' key in torrent file".into()))?;

    let info_start = info_pos + info_key.len();
    let info_bytes = find_bencode_value_end(data, info_start)?;

    use sha1::{Digest, Sha1};
    let hash = Sha1::digest(info_bytes);
    Ok(hash.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Given bencoded data starting at `start`, find the complete bencoded value
/// and return the slice containing it.
fn find_bencode_value_end(data: &[u8], start: usize) -> Result<&[u8], ScraperError> {
    if start >= data.len() {
        return Err(ScraperError::ParseError("Unexpected end of torrent data".into()));
    }

    let mut pos = start;
    match data[pos] {
        b'd' => {
            pos += 1;
            while pos < data.len() && data[pos] != b'e' {
                let key_slice = find_bencode_value_end(data, pos)?;
                pos += key_slice.len();
                let val_slice = find_bencode_value_end(data, pos)?;
                pos += val_slice.len();
            }
            if pos >= data.len() {
                return Err(ScraperError::ParseError("Unterminated dictionary".into()));
            }
            pos += 1;
            Ok(&data[start..pos])
        }
        b'l' => {
            pos += 1;
            while pos < data.len() && data[pos] != b'e' {
                let val_slice = find_bencode_value_end(data, pos)?;
                pos += val_slice.len();
            }
            if pos >= data.len() {
                return Err(ScraperError::ParseError("Unterminated list".into()));
            }
            pos += 1;
            Ok(&data[start..pos])
        }
        b'i' => {
            let end = data[pos..]
                .iter()
                .position(|&b| b == b'e')
                .ok_or_else(|| ScraperError::ParseError("Unterminated integer".into()))?;
            Ok(&data[start..=pos + end])
        }
        b'0'..=b'9' => {
            let colon = data[pos..]
                .iter()
                .position(|&b| b == b':')
                .ok_or_else(|| ScraperError::ParseError("Invalid byte string".into()))?;
            let len_str = std::str::from_utf8(&data[pos..pos + colon])
                .map_err(|_| ScraperError::ParseError("Invalid length".into()))?;
            let len: usize = len_str
                .parse()
                .map_err(|_| ScraperError::ParseError("Invalid length number".into()))?;
            let end = pos + colon + 1 + len;
            if end > data.len() {
                return Err(ScraperError::ParseError("Byte string exceeds data".into()));
            }
            Ok(&data[start..end])
        }
        _ => Err(ScraperError::ParseError(format!(
            "Unknown bencode type: {}",
            data[pos] as char
        ))),
    }
}
