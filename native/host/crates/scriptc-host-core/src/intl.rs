//! `Intl`: the ECMA-402 formatters a page reads as `Intl.NumberFormat`, `Intl.PluralRules` and `Intl.ListFormat`,
//! with CLDR's data for English and German (and English's for any other locale). A browser carries every locale's
//! data; this host carries two locales (English and German), and answers any other locale as English rather than
//! failing the call.
//!
//! What is answered:
//! - `new Intl.NumberFormat(locales, { minimumFractionDigits, maximumFractionDigits, useGrouping })` and `format(n)`:
//!   decimal style, rounded half away from zero, CLDR's separators (en `1,234.5`, de `1.234,5`);
//! - `new Intl.PluralRules(locales, { type })` and `select(n)`: cardinal (en, de: `one` for an integer 1, else
//!   `other`) and ordinal (en: `one`/`two`/`few`/`other`; de: `other`);
//! - `new Intl.ListFormat(locales, { type, style })` and `format(list)`: conjunction, disjunction and unit lists, long
//!   style (en `a, b, and c`; de `a, b und c`).
//!
//! `resolvedOptions()` answers `{ locale }`. Everything else (currency and percent styles, compact notation, other
//! locales' data) is not answered.

use crate::objects::{self, Value};

/// The two locales with data here; anything else is English.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Lang {
    En,
    De,
}

impl Lang {
    fn tag(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::De => "de",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ListType {
    Conjunction,
    Disjunction,
    Unit,
}

/// One constructed formatter (objects.rs `Kind::Intl`).
pub enum Formatter {
    Number { lang: Lang, min_fraction: usize, max_fraction: usize, grouping: bool },
    Plural { lang: Lang, ordinal: bool },
    List { lang: Lang, kind: ListType },
}

/// `Intl.<name>`: the constructor's builtin name, for the ones answered here.
pub fn namespace_get(name: &str) -> Option<&'static str> {
    match name {
        "NumberFormat" => Some("Intl.NumberFormat"),
        "PluralRules" => Some("Intl.PluralRules"),
        "ListFormat" => Some("Intl.ListFormat"),
        _ => None,
    }
}

/// The first requested locale's language (a string, or the first of an array); English when none is given.
fn lang_of(locales: Option<&Value>) -> Lang {
    let tag = match locales {
        Some(Value::Str(s)) => s.clone(),
        Some(Value::Object(r)) => match objects::get(*r, "0") {
            Ok(Value::Str(s)) => s,
            _ => String::new(),
        },
        _ => String::new(),
    };
    match tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase().as_str() {
        "de" => Lang::De,
        _ => Lang::En,
    }
}

/// An option's value from the options bag, if it has one.
fn option(options: Option<&Value>, name: &str) -> Option<Value> {
    let Some(Value::Object(r)) = options else { return None };
    match objects::get(*r, name) {
        Ok(Value::Undefined) | Err(_) => None,
        Ok(v) => Some(v),
    }
}

fn digits(options: Option<&Value>, name: &str) -> Result<Option<usize>, String> {
    match option(options, name) {
        None => Ok(None),
        Some(Value::Number(n)) if (0.0..=100.0).contains(&n) => Ok(Some(n as usize)),
        Some(_) => Err(format!("{name} value is out of range.")),
    }
}

/// `new Intl.<name>(locales, options)`.
pub fn construct(name: &str, args: &[Value]) -> Result<Formatter, String> {
    let lang = lang_of(args.first());
    let options = args.get(1);
    match name {
        "Intl.NumberFormat" => {
            let min = digits(options, "minimumFractionDigits")?;
            let max = digits(options, "maximumFractionDigits")?;
            // ECMA-402's defaults for the decimal style: 0 and max(min, 3).
            let min_fraction = min.unwrap_or(0);
            let max_fraction = max.unwrap_or(min_fraction.max(3));
            if max_fraction < min_fraction {
                return Err("maximumFractionDigits value is out of range.".into());
            }
            let grouping = !matches!(option(options, "useGrouping"), Some(Value::Bool(false)));
            Ok(Formatter::Number { lang, min_fraction, max_fraction, grouping })
        }
        "Intl.PluralRules" => {
            let ordinal = matches!(option(options, "type"), Some(Value::Str(t)) if t == "ordinal");
            Ok(Formatter::Plural { lang, ordinal })
        }
        "Intl.ListFormat" => {
            let kind = match option(options, "type") {
                Some(Value::Str(t)) if t == "disjunction" => ListType::Disjunction,
                Some(Value::Str(t)) if t == "unit" => ListType::Unit,
                _ => ListType::Conjunction,
            };
            Ok(Formatter::List { lang, kind })
        }
        _ => Err(format!("{name} is not a constructor")),
    }
}

pub fn has_method(f: &Formatter, name: &str) -> bool {
    match f {
        Formatter::Number { .. } | Formatter::List { .. } => matches!(name, "format" | "resolvedOptions"),
        Formatter::Plural { .. } => matches!(name, "select" | "resolvedOptions"),
    }
}

pub fn call(f: &Formatter, name: &str, args: &[Value]) -> Result<Value, String> {
    let lang = match f {
        Formatter::Number { lang, .. } | Formatter::Plural { lang, .. } | Formatter::List { lang, .. } => *lang,
    };
    match (f, name) {
        (_, "resolvedOptions") => {
            let options = crate::values::new_object();
            if let Value::Object(r) = &options {
                crate::values::set(*r, "locale", Value::Str(lang.tag().into()))?;
            }
            Ok(options)
        }
        (Formatter::Number { min_fraction, max_fraction, grouping, .. }, "format") => {
            Ok(Value::Str(format_number(lang, number_arg(args), *min_fraction, *max_fraction, *grouping)))
        }
        (Formatter::Plural { ordinal, .. }, "select") => Ok(Value::Str(select(lang, *ordinal, number_arg(args)).into())),
        (Formatter::List { kind, .. }, "format") => {
            let items = match args.first() {
                Some(Value::Object(r)) => list_items(*r)?,
                None | Some(Value::Undefined) => Vec::new(),
                Some(_) => return Err("Intl.ListFormat.format: the list is not iterable".into()),
            };
            Ok(Value::Str(format_list(lang, *kind, &items)))
        }
        _ => Err(format!("{name} is not a function")),
    }
}

fn number_arg(args: &[Value]) -> f64 {
    match args.first() {
        Some(Value::Number(n)) => *n,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Str(s)) => s.trim().parse().unwrap_or(f64::NAN),
        Some(Value::Null) => 0.0,
        _ => f64::NAN,
    }
}

/// A list's strings, in order (an array's elements; anything else's own indexed values).
fn list_items(r: u64) -> Result<Vec<String>, String> {
    let mut items = Vec::new();
    let mut i = 0usize;
    loop {
        let keys = objects::own_keys(r);
        if !keys.iter().any(|k| k.parse::<usize>() == Ok(i)) {
            break;
        }
        match objects::get(r, &i.to_string())? {
            Value::Str(s) => items.push(s),
            _ => return Err("Iterable yielded a non-String value".into()),
        }
        i += 1;
    }
    Ok(items)
}

fn format_number(lang: Lang, n: f64, min_fraction: usize, max_fraction: usize, grouping: bool) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    let negative = n < 0.0;
    if n.is_infinite() {
        return if negative { "-∞".into() } else { "∞".into() };
    }
    // Half away from zero at max_fraction digits (ECMA-402's rounding), through the shortest decimal of the value.
    let scale = 10f64.powi(max_fraction as i32);
    let rounded = (n.abs() * scale).round() / scale;
    let fixed = format!("{rounded:.max_fraction$}");
    let (int_part, frac_part) = fixed.split_once('.').map_or((fixed.as_str(), ""), |(i, f)| (i, f));
    let mut frac = frac_part.to_string();
    while frac.len() > min_fraction && frac.ends_with('0') {
        frac.pop();
    }
    let (group, decimal) = match lang {
        Lang::En => (',', '.'),
        Lang::De => ('.', ','),
    };
    let mut out = String::new();
    if negative && (rounded != 0.0) {
        out.push('-');
    }
    let digits: Vec<char> = int_part.chars().collect();
    for (i, d) in digits.iter().enumerate() {
        if grouping && i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(group);
        }
        out.push(*d);
    }
    if !frac.is_empty() {
        out.push(decimal);
        out.push_str(&frac);
    }
    out
}

/// CLDR's plural category for `n` (its integer and visible-fraction operands from the shortest decimal).
fn select(lang: Lang, ordinal: bool, n: f64) -> &'static str {
    if !n.is_finite() {
        return "other";
    }
    let n = n.abs();
    let integer = n.fract() == 0.0;
    if ordinal {
        if lang == Lang::De || !integer {
            return "other";
        }
        let (m10, m100) = (n % 10.0, n % 100.0);
        return if m10 == 1.0 && m100 != 11.0 {
            "one"
        } else if m10 == 2.0 && m100 != 12.0 {
            "two"
        } else if m10 == 3.0 && m100 != 13.0 {
            "few"
        } else {
            "other"
        };
    }
    // en and de: one is i = 1 with no visible fraction digits.
    if integer && n == 1.0 { "one" } else { "other" }
}

fn format_list(lang: Lang, kind: ListType, items: &[String]) -> String {
    let word = match (lang, kind) {
        (_, ListType::Unit) => None,
        (Lang::En, ListType::Conjunction) => Some("and"),
        (Lang::En, ListType::Disjunction) => Some("or"),
        (Lang::De, ListType::Conjunction) => Some("und"),
        (Lang::De, ListType::Disjunction) => Some("oder"),
    };
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => match word {
            Some(w) => format!("{a} {w} {b}"),
            None => format!("{a}, {b}"),
        },
        [head @ .., last] => {
            let joined = head.join(", ");
            match (word, lang) {
                // English's serial comma; German has none.
                (Some(w), Lang::En) => format!("{joined}, {w} {last}"),
                (Some(w), Lang::De) => format!("{joined} {w} {last}"),
                (None, _) => format!("{joined}, {last}"),
            }
        }
    }
}
