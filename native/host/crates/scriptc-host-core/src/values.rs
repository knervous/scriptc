//! Plain values the program builds and the host hands out: objects (object literals, JSON, records crossing in),
//! arrays, typed arrays, Error objects, promises and iterators. Each lives in the object table as `Kind::Value`; its
//! data lives here, keyed by its reference.
//!
//! A value stored inside one of these (a property, an element, a settlement) holds its own count; the data releases
//! them when the object goes. Calls back into the program (a getter, an array callback, a promise reaction) never run
//! while this module's table is borrowed.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};

use crate::abi::{self, HostVal};
use crate::objects::{self, Value};

/// A typed array's element kinds (the runtime's `ScrBytesElem` numbering).
pub const U8: u32 = 0;
const U32: u32 = 1;
const F32: u32 = 2;
const I32: u32 = 3;
const F64: u32 = 4;
const I8: u32 = 5;
const U16: u32 = 6;
const I16: u32 = 7;
const U8C: u32 = 8;

pub fn elem_size(elem: u32) -> usize {
    match elem {
        U8 | I8 | U8C => 1,
        U16 | I16 => 2,
        U32 | I32 | F32 => 4,
        _ => 8,
    }
}

fn elem_name(elem: u32) -> &'static str {
    match elem {
        U8 => "Uint8Array",
        U32 => "Uint32Array",
        F32 => "Float32Array",
        I32 => "Int32Array",
        F64 => "Float64Array",
        I8 => "Int8Array",
        U16 => "Uint16Array",
        I16 => "Int16Array",
        _ => "Uint8ClampedArray",
    }
}

enum Slot {
    Data(Value),
    /// An accessor: the getter (a closure or a host function) runs with the object as its receiver.
    Getter(Value),
}

struct Prop {
    key: String,
    slot: Slot,
    enumerable: bool,
}

/// A promise's state and the reactions waiting on it.
#[derive(Default)]
struct PromiseData {
    settled: Option<(bool, Value)>,
    reactions: Vec<Reaction>,
}

/// A native subscriber (the island's bridge to a compiled promise).
pub type Settled = unsafe extern "C" fn(ctx: *mut std::ffi::c_void, rejected: i32, value: *const HostVal);

enum Reaction {
    /// `then(onFulfilled, onRejected)` (catch: Undefined, f): the handlers and the derived promise.
    Then { on_ok: Value, on_err: Value, derived: u64 },
    Finally { f: Value, derived: u64 },
    Native { settled: Settled, ctx: usize },
    /// A promise resolved with this one takes its state.
    Adopt { target: u64 },
}

enum Data {
    Object { props: Vec<Prop>, error: bool },
    /// The elements, and named properties set on the array (a template's `raw`, an expando).
    Array(Vec<Value>, Vec<(String, Value)>),
    /// A typed array: the host's copy, and for one the program handed over, the program's own storage.
    Bytes { elem: u32, data: Vec<u8>, storage: Option<Storage> },
    Promise(PromiseData),
    /// An iterator over an array (live: it reads the array at each step) or a snapshot.
    Iterator { array: Option<u64>, items: Vec<Value>, index: usize },
}

thread_local! {
    static STORE: RefCell<HashMap<u64, Data>> = RefCell::new(HashMap::new());
    /// Promise reactions due on the next turn of the event loop: the reaction, how its promise settled, the value.
    static JOBS: RefCell<VecDeque<(Reaction, bool, Value)>> = const { RefCell::new(VecDeque::new()) };
}

/// A value's own count, for storing it.
pub fn retain_value(v: &Value) {
    match v {
        Value::Object(r) => objects::retain(*r),
        Value::Closure(c) | Value::Program(c) => abi::closure_retain(*c),
        _ => {}
    }
}

pub fn release_value(v: Value) {
    match v {
        Value::Object(r) => objects::release(r),
        Value::Closure(c) | Value::Program(c) => abi::closure_release(c),
        _ => {}
    }
}

fn kept(v: &Value) -> Value {
    retain_value(v);
    v.clone()
}

fn alloc(data: Data) -> Value {
    let r = objects::alloc_value();
    STORE.with(|s| s.borrow_mut().insert(r, data));
    Value::Object(r)
}

/// Drops an object's data (its table entry is gone), releasing what it held.
pub fn free(r: u64) {
    let Some(data) = STORE.with(|s| s.borrow_mut().remove(&r)) else { return };
    let mut held = Vec::new();
    match data {
        Data::Object { props, .. } => held.extend(props.into_iter().map(|p| match p.slot { Slot::Data(v) | Slot::Getter(v) => v })),
        Data::Array(items, named) => {
            held.extend(items);
            held.extend(named.into_iter().map(|(_, v)| v));
        }
        Data::Bytes { storage, .. } => drop(storage),
        Data::Promise(p) => {
            if let Some((_, v)) = p.settled { held.push(v) }
            for reaction in p.reactions { drop_reaction(reaction) }
        }
        Data::Iterator { array, items, .. } => {
            held.extend(array.map(Value::Object));
            held.extend(items);
        }
    }
    for v in held {
        release_value(v);
    }
}

fn drop_reaction(reaction: Reaction) {
    match reaction {
        Reaction::Then { on_ok, on_err, derived } => { release_value(on_ok); release_value(on_err); objects::release(derived) }
        Reaction::Finally { f, derived } => { release_value(f); objects::release(derived) }
        Reaction::Native { .. } => {}
        Reaction::Adopt { target } => objects::release(target),
    }
}

fn with<T>(r: u64, f: impl FnOnce(&mut Data) -> T) -> Option<T> {
    STORE.with(|s| s.borrow_mut().get_mut(&r).map(f))
}

// ── construction ─────────────────────────────────────────────────────────

pub fn new_object() -> Value {
    alloc(Data::Object { props: Vec::new(), error: false })
}

/// An array of `items` (each retained here).
pub fn new_array(items: &[Value]) -> Value {
    alloc(Data::Array(items.iter().map(kept).collect(), Vec::new()))
}

pub fn new_bytes(elem: u32, data: Vec<u8>) -> Value {
    alloc(Data::Bytes { elem, data, storage: None })
}

/// A compiled typed array's storage, held while a host typed array made from it lives (the runtime's ScrBytes, +1).
pub struct Storage {
    pub at: *mut u8,
    pub len: usize,
    pub owner: *mut std::ffi::c_void,
}

unsafe extern "C" {
    fn scr_host_bytes_release(owner: *mut std::ffi::c_void);
}

impl Drop for Storage {
    fn drop(&mut self) {
        // SAFETY: owner is the +1 new_bytes_owned was handed, given back once.
        unsafe { scr_host_bytes_release(self.owner) }
    }
}

pub fn new_bytes_owned(elem: u32, data: Vec<u8>, storage: Storage) -> Value {
    alloc(Data::Bytes { elem, data, storage: Some(storage) })
}

/// The program's own storage behind a typed array it handed over (a page function writes such an array in place):
/// its address and byte length, valid while `r` lives. None for a host-made typed array.
pub fn bytes_storage(r: u64) -> Option<(*mut u8, usize)> {
    with(r, |d| match d {
        Data::Bytes { storage: Some(s), .. } => Some((s.at, s.len)),
        _ => None,
    })
    .flatten()
}

/// The element kind a typed-array constructor makes (ArrayBuffer: plain bytes).
pub fn typed_array_elem(name: &str) -> Option<u32> {
    Some(match name {
        "Uint8Array" | "ArrayBuffer" => U8,
        "Int8Array" => I8,
        "Uint8ClampedArray" => U8C,
        "Uint16Array" => U16,
        "Int16Array" => I16,
        "Uint32Array" => U32,
        "Int32Array" => I32,
        "Float32Array" => F32,
        "Float64Array" => F64,
        _ => return None,
    })
}

/// `new <TypedArray>(arg)` on the host: a length (zeroed), another host typed array or buffer (its bytes, read as this
/// element kind: a copy, where the page's would be a view of the same buffer), or an array of numbers.
pub fn typed_array_construct(name: &str, args: &[Value]) -> Result<Value, String> {
    let elem = typed_array_elem(name).ok_or_else(|| format!("{name} is not a constructor"))?;
    let size = elem_size(elem);
    let data = match args.first() {
        None | Some(Value::Undefined) => Vec::new(),
        Some(Value::Number(n)) if *n >= 0.0 && n.fract() == 0.0 => vec![0u8; *n as usize * size],
        Some(Value::Number(_)) => return Err(abi::throw(new_error("RangeError", "Invalid typed array length"))),
        Some(Value::Object(r)) => match bytes_of(*r) {
            Some((_, bytes)) if bytes.len() % size != 0 => {
                return Err(abi::throw(new_error("RangeError", &format!("byte length of {name} should be a multiple of {size}"))));
            }
            Some((_, bytes)) => bytes,
            None if is_array(*r) => {
                let items: Vec<Value> = own_keys(*r).iter().filter(|k| k.parse::<usize>().is_ok()).map(|k| objects::get(*r, k)).collect::<Result<_, _>>()?;
                let mut data = vec![0u8; items.len() * size];
                for (i, v) in items.iter().enumerate() {
                    let n = match v { Value::Number(n) => *n, Value::Bool(b) => *b as u8 as f64, _ => f64::NAN };
                    write_elem(elem, &mut data[i * size..(i + 1) * size], n);
                }
                data
            }
            None => return Err(format!("{name}: the native host island cannot make one from this value")),
        },
        Some(_) => Vec::new(),
    };
    Ok(new_bytes(elem, data))
}

pub fn new_error(name: &str, message: &str) -> Value {
    let prop = |key: &str, v: &str| Prop { key: key.into(), slot: Slot::Data(Value::Str(v.into())), enumerable: false };
    alloc(Data::Object { props: vec![prop("name", name), prop("message", message), prop("stack", &format!("{name}: {message}"))], error: true })
}

pub fn new_promise() -> Value {
    alloc(Data::Promise(PromiseData::default()))
}

/// A fresh `{ value, done }`.
fn iter_result(value: Value, done: bool) -> Value {
    retain_value(&value);
    alloc(Data::Object {
        props: vec![
            Prop { key: "value".into(), slot: Slot::Data(value), enumerable: true },
            Prop { key: "done".into(), slot: Slot::Data(Value::Bool(done)), enumerable: true },
        ],
        error: false,
    })
}

/// An iterator over a snapshot (values retained here).
pub fn new_snapshot_iterator(items: Vec<Value>) -> Value {
    for v in &items {
        retain_value(v);
    }
    alloc(Data::Iterator { array: None, items, index: 0 })
}

// ── queries ──────────────────────────────────────────────────────────────

pub fn is_array(r: u64) -> bool {
    with(r, |d| matches!(d, Data::Array(..))).unwrap_or(false)
}

/// A plain value's kind as the call trace names it (abi.rs `calls`).
pub fn trace_kind(r: u64) -> Option<&'static str> {
    with(r, |d| match d {
        Data::Object { error: true, .. } => "value Error",
        Data::Object { .. } => "value object",
        Data::Array(..) => "value array",
        Data::Bytes { elem, .. } => elem_name(*elem),
        Data::Promise(_) => "value Promise",
        Data::Iterator { .. } => "value iterator",
    })
}

pub fn is_promise(r: u64) -> bool {
    with(r, |d| matches!(d, Data::Promise(_))).unwrap_or(false)
}

/// The brand tests the checked-dynamic tree narrows with (util.types names).
pub fn type_probe(r: u64, probe: &str) -> bool {
    with(r, |d| match (d, probe) {
        (Data::Bytes { .. }, "isTypedArray" | "isArrayBufferView") => true,
        (Data::Bytes { elem, .. }, _) => probe.strip_prefix("is") == Some(elem_name(*elem)),
        (Data::Promise(_), "isPromise") => true,
        (Data::Object { error: true, .. }, "isNativeError") => true,
        _ => false,
    })
    .unwrap_or(false)
}

/// A typed array's kind and storage, borrowed until the next host call (nothing moves the vector before then).
pub fn bytes_view(r: u64) -> Option<(u32, *const u8, usize)> {
    with(r, |d| match d {
        Data::Bytes { elem, data, .. } => Some((*elem, data.as_ptr(), data.len())),
        _ => None,
    })
    .flatten()
}

/// A typed array's bytes, copied.
pub fn bytes_of(r: u64) -> Option<(u32, Vec<u8>)> {
    with(r, |d| match d {
        Data::Bytes { elem, data, .. } => Some((*elem, data.clone())),
        _ => None,
    })
    .flatten()
}

fn array_index(name: &str) -> Option<usize> {
    if name.is_empty() || (name.len() > 1 && name.starts_with('0')) || !name.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    name.parse::<u32>().ok().filter(|i| *i != u32::MAX).map(|i| i as usize)
}

/// Own enumerable string keys in JavaScript's order: array indices ascending, then the rest in insertion order.
pub fn own_keys(r: u64) -> Vec<String> {
    with(r, |d| match d {
        Data::Object { props, .. } => {
            let mut indices: Vec<(usize, String)> = Vec::new();
            let mut names = Vec::new();
            for p in props.iter().filter(|p| p.enumerable) {
                match array_index(&p.key) {
                    Some(i) => indices.push((i, p.key.clone())),
                    None => names.push(p.key.clone()),
                }
            }
            indices.sort_by_key(|(i, _)| *i);
            indices.into_iter().map(|(_, k)| k).chain(names).collect()
        }
        Data::Array(items, named) => (0..items.len()).map(|i| i.to_string()).chain(named.iter().map(|(k, _)| k.clone())).collect(),
        Data::Bytes { elem, data, .. } => (0..data.len() / elem_size(*elem)).map(|i| i.to_string()).collect(),
        _ => Vec::new(),
    })
    .unwrap_or_default()
}

pub fn has_own(r: u64, name: &str) -> bool {
    with(r, |d| match d {
        Data::Object { props, .. } => props.iter().any(|p| p.key == name),
        Data::Array(items, named) => name == "length" || array_index(name).is_some_and(|i| i < items.len()) || named.iter().any(|(k, _)| k == name),
        Data::Bytes { elem, data, .. } => array_index(name).is_some_and(|i| i < data.len() / elem_size(*elem)),
        _ => false,
    })
    .unwrap_or(false)
}

fn read_elem(elem: u32, b: &[u8]) -> f64 {
    match elem {
        U8 | U8C => b[0] as f64,
        I8 => b[0] as i8 as f64,
        U16 => u16::from_le_bytes([b[0], b[1]]) as f64,
        I16 => i16::from_le_bytes([b[0], b[1]]) as f64,
        U32 => u32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
        I32 => i32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
        F32 => f32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
        _ => f64::from_le_bytes(b[..8].try_into().unwrap()),
    }
}

/// ToInt32-style wrapping, as a typed-array store converts.
fn wrap_int(n: f64, bits: u32) -> i64 {
    if !n.is_finite() {
        return 0;
    }
    let m = 2f64.powi(bits as i32);
    let v = n.trunc().rem_euclid(m);
    v as i64
}

fn write_elem(elem: u32, b: &mut [u8], n: f64) {
    match elem {
        U8 | I8 => b[0] = wrap_int(n, 8) as u8,
        U8C => b[0] = if n.is_nan() { 0 } else { n.clamp(0.0, 255.0).round_ties_even() as u8 },
        U16 | I16 => b[..2].copy_from_slice(&(wrap_int(n, 16) as u16).to_le_bytes()),
        U32 | I32 => b[..4].copy_from_slice(&(wrap_int(n, 32) as u32).to_le_bytes()),
        F32 => b[..4].copy_from_slice(&(n as f32).to_le_bytes()),
        _ => b[..8].copy_from_slice(&n.to_le_bytes()),
    }
}

// ── properties ───────────────────────────────────────────────────────────

/// What a property read found: a value (borrowed from the data), or a getter to run outside the borrow.
enum Read {
    Value(Value),
    Getter(Value),
    Missing,
}

/// A property of a plain value: `None` when it has no such own property (the caller then offers a method as a value).
pub fn get(r: u64, name: &str) -> Result<Option<Value>, String> {
    let read = with(r, |d| match d {
        Data::Object { props, .. } => match props.iter().find(|p| p.key == name) {
            Some(Prop { slot: Slot::Data(v), .. }) => Read::Value(v.clone()),
            Some(Prop { slot: Slot::Getter(f), .. }) => Read::Getter(kept(f)),
            None => Read::Missing,
        },
        Data::Array(items, named) => match name {
            "length" => Read::Value(Value::Number(items.len() as f64)),
            _ => match array_index(name) {
                Some(i) => Read::Value(items.get(i).cloned().unwrap_or(Value::Undefined)),
                None => named.iter().find(|(k, _)| k == name).map_or(Read::Missing, |(_, v)| Read::Value(v.clone())),
            },
        },
        Data::Bytes { elem, data, .. } => {
            let size = elem_size(*elem);
            match name {
                "length" => Read::Value(Value::Number((data.len() / size) as f64)),
                "byteLength" => Read::Value(Value::Number(data.len() as f64)),
                "byteOffset" => Read::Value(Value::Number(0.0)),
                "BYTES_PER_ELEMENT" => Read::Value(Value::Number(size as f64)),
                _ => match array_index(name) {
                    Some(i) if (i + 1) * size <= data.len() => Read::Value(Value::Number(read_elem(*elem, &data[i * size..(i + 1) * size]))),
                    Some(_) => Read::Value(Value::Undefined),
                    None => Read::Missing,
                },
            }
        }
        _ => Read::Missing,
    })
    .ok_or("a released host object")?;
    match read {
        Read::Value(v) => Ok(Some(v)),
        Read::Getter(f) => {
            let out = call_value(&f, Some(r), &[]);
            // The getter's own count goes once the call is over; a result it answered is the program's.
            release_value(f);
            out.map(Some)
        }
        Read::Missing => Ok(None),
    }
}

/// get, with a missing property read as undefined.
fn get_or_undefined(r: u64, name: &str) -> Value {
    get(r, name).ok().flatten().unwrap_or(Value::Undefined)
}

pub fn set(r: u64, name: &str, value: Value) -> Result<(), String> {
    retain_value(&value);
    // Ok: the values the write displaced, released once the borrow is over.
    let outcome: Result<Vec<Value>, (Value, String)> = with(r, |d| match d {
        Data::Object { props, .. } => match props.iter_mut().find(|p| p.key == name) {
            Some(Prop { slot: Slot::Getter(_), .. }) => Err((value, format!("Cannot set property {name} of #<Object> which has only a getter"))),
            Some(Prop { slot: Slot::Data(old), .. }) => Ok(vec![std::mem::replace(old, value)]),
            None => {
                props.push(Prop { key: name.into(), slot: Slot::Data(value), enumerable: true });
                Ok(Vec::new())
            }
        },
        Data::Array(items, named) => {
            if name == "length" {
                let n = match value { Value::Number(n) if n >= 0.0 && n.fract() == 0.0 && n <= u32::MAX as f64 => n as usize, other => return Err((other, "Invalid array length".into())) };
                let dropped: Vec<Value> = if n < items.len() { items.drain(n..).collect() } else { Vec::new() };
                items.resize(n, Value::Undefined);
                return Ok(dropped);
            }
            match array_index(name) {
                Some(i) => {
                    if i >= items.len() {
                        items.resize(i + 1, Value::Undefined);
                    }
                    Ok(vec![std::mem::replace(&mut items[i], value)])
                }
                None => match named.iter_mut().find(|(k, _)| k == name) {
                    Some((_, old)) => Ok(vec![std::mem::replace(old, value)]),
                    None => { named.push((name.into(), value)); Ok(Vec::new()) }
                },
            }
        }
        Data::Bytes { elem, data, .. } => {
            let size = elem_size(*elem);
            match array_index(name) {
                Some(i) if (i + 1) * size <= data.len() => {
                    let n = match &value { Value::Number(n) => *n, Value::Bool(b) => *b as u8 as f64, _ => f64::NAN };
                    write_elem(*elem, &mut data[i * size..(i + 1) * size], n);
                    Ok(Vec::new())
                }
                // Out-of-range typed-array writes are ignored, as in JavaScript.
                Some(_) => Ok(Vec::new()),
                None => Err((value, format!("cannot set '{name}' on a typed array"))),
            }
        }
        _ => Err((value, format!("cannot set '{name}' on this host object"))),
    })
    .ok_or("a released host object")?;
    match outcome {
        Ok(displaced) => { for v in displaced { release_value(v) } Ok(()) }
        Err((value, msg)) => { release_value(value); Err(msg) }
    }
}

pub fn define_getter(r: u64, name: &str, getter: Value) -> Result<(), String> {
    retain_value(&getter);
    let old = with(r, |d| match d {
        Data::Object { props, .. } => {
            let prop = Prop { key: name.into(), slot: Slot::Getter(getter), enumerable: true };
            match props.iter_mut().find(|p| p.key == name) {
                Some(p) => Ok(Some(std::mem::replace(p, prop))),
                None => { props.push(prop); Ok(None) }
            }
        }
        _ => Err(getter),
    })
    .ok_or("a released host object")?;
    match old {
        Ok(Some(p)) => { release_value(match p.slot { Slot::Data(v) | Slot::Getter(v) => v }); Ok(()) }
        Ok(None) => Ok(()),
        Err(getter) => { release_value(getter); Err("a getter on a host value that is not a plain object".into()) }
    }
}

// ── methods ──────────────────────────────────────────────────────────────

const ARRAY_METHODS: &[&str] = &[
    "push", "pop", "shift", "unshift", "slice", "concat", "indexOf", "includes", "join", "reverse", "forEach", "map", "filter", "find",
    "findIndex", "some", "every", "reduce", "at", "toString", "keys", "values", "entries",
];

pub fn has_method(r: u64, name: &str) -> bool {
    with(r, |d| match d {
        Data::Object { .. } => matches!(name, "toString" | "hasOwnProperty"),
        Data::Array(..) => ARRAY_METHODS.contains(&name),
        Data::Bytes { .. } => matches!(name, "slice" | "subarray" | "fill" | "set" | "toString"),
        Data::Promise(_) => matches!(name, "then" | "catch" | "finally"),
        Data::Iterator { .. } => name == "next",
    })
    .unwrap_or(false)
}

/// Calls a function value: a compiled closure (Err(""): its exception is pending in the program) or a host function.
pub fn call_value(f: &Value, this: Option<u64>, args: &[Value]) -> Result<Value, String> {
    match f {
        Value::Closure(c) => abi::call_closure(*c, args).map_err(|()| String::new()),
        Value::Object(r) if objects::is_callable(*r) => objects::call(*r, this, args),
        _ => Err("not a function".into()),
    }
}

fn callable(v: &Value) -> bool {
    match v {
        Value::Closure(_) => true,
        Value::Object(r) => objects::is_callable(*r),
        _ => false,
    }
}

fn items_of(r: u64) -> Vec<Value> {
    with(r, |d| match d {
        Data::Array(items, _) => items.clone(),
        _ => Vec::new(),
    })
    .unwrap_or_default()
}

fn same_value_zero(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => strict_equal(a, b),
    }
}

pub fn strict_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Number(x), Value::Number(y)) => x == y,
        (Value::Str(x), Value::Str(y)) => x == y,
        (Value::Object(x), Value::Object(y)) | (Value::Closure(x), Value::Closure(y)) | (Value::Program(x), Value::Program(y)) => x == y,
        _ => false,
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Undefined | Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => !(*n == 0.0 || n.is_nan()),
        Value::Str(s) => !s.is_empty(),
        _ => true,
    }
}

/// A relative index argument (slice, at): ToIntegerOrInfinity, negatives from the end, clamped to [0, len].
fn rel_index(arg: Option<&Value>, len: usize, default: usize) -> usize {
    match arg {
        Some(Value::Number(n)) if !n.is_nan() => {
            let n = n.trunc();
            if n < 0.0 { (len as f64 + n).max(0.0) as usize } else { n.min(len as f64) as usize }
        }
        Some(Value::Undefined) | None => default,
        _ => 0,
    }
}

pub fn call_method(r: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    // An own property holding a function (`{ get: () => 1 }.get()`) is called with the object as its receiver.
    if let Some(f) = get(r, name)?.filter(callable) {
        retain_value(&f);
        let out = call_value(&f, Some(r), args);
        release_value(f);
        return out;
    }
    enum K { Object(bool), Array, Bytes, Promise, Iterator }
    let kind = with(r, |d| match d {
        Data::Object { error, .. } => K::Object(*error),
        Data::Array(..) => K::Array,
        Data::Bytes { .. } => K::Bytes,
        Data::Promise(_) => K::Promise,
        Data::Iterator { .. } => K::Iterator,
    })
    .ok_or("a released host object")?;
    match kind {
        K::Object(error) => match name {
            "toString" if error => {
                let field = |k: &str| match get_or_undefined(r, k) { Value::Str(s) => s, _ => String::new() };
                let (n, m) = (field("name"), field("message"));
                Ok(Value::Str(if m.is_empty() { n } else if n.is_empty() { m } else { format!("{n}: {m}") }))
            }
            "toString" => Ok(Value::Str("[object Object]".into())),
            "hasOwnProperty" => Ok(Value::Bool(has_own(r, &args.first().map(objects::to_display).unwrap_or_default()))),
            _ => Err(format!("{name} is not a function")),
        },
        K::Array => array_method(r, name, args),
        K::Bytes => bytes_method(r, name, args),
        K::Promise => promise_method(r, name, args),
        K::Iterator => {
            // (the array it walks, or None for a snapshot; the index this step reads)
            let step = with(r, |d| match d {
                Data::Iterator { array, index, .. } => {
                    *index += 1;
                    Some((*array, *index - 1))
                }
                _ => None,
            })
            .flatten();
            let value = match step {
                Some((Some(a), at)) => items_of(a).get(at).cloned(),
                Some((None, at)) => with(r, |d| match d { Data::Iterator { items, .. } => items.get(at).cloned(), _ => None }).flatten(),
                None => None,
            };
            Ok(match value {
                Some(v) => iter_result(v, false),
                None => iter_result(Value::Undefined, true),
            })
        }
    }
}

fn array_method(r: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Undefined);
    let each = |f: &Value, mut visit: Box<dyn FnMut(usize, &Value, Value) -> bool + '_>| -> Result<(), String> {
        if !callable(f) {
            return Err(format!("{} is not a function", objects::to_display(f)));
        }
        let items = items_of(r);
        for (i, v) in items.iter().enumerate() {
            let result = call_value(f, None, &[v.clone(), Value::Number(i as f64), Value::Object(r)])?;
            if !visit(i, v, result) {
                break;
            }
        }
        Ok(())
    };
    match name {
        "push" => {
            let n = with(r, |d| match d {
                Data::Array(items, _) => { items.extend(args.iter().map(kept)); items.len() }
                _ => 0,
            })
            .unwrap_or(0);
            Ok(Value::Number(n as f64))
        }
        "unshift" => {
            let n = with(r, |d| match d {
                Data::Array(items, _) => { items.splice(0..0, args.iter().map(kept)); items.len() }
                _ => 0,
            })
            .unwrap_or(0);
            Ok(Value::Number(n as f64))
        }
        "pop" | "shift" => {
            let v = with(r, |d| match d {
                Data::Array(items, _) if name == "pop" => items.pop(),
                Data::Array(items, _) if !items.is_empty() => Some(items.remove(0)),
                _ => None,
            })
            .flatten()
            .unwrap_or(Value::Undefined);
            // The array's count on the value moves to the caller's result (dropped once the result is out).
            objects::release_value_after_return(v.clone());
            Ok(v)
        }
        "slice" => {
            let items = items_of(r);
            let start = rel_index(args.first(), items.len(), 0);
            let end = rel_index(args.get(1), items.len(), items.len());
            Ok(new_array(if start < end { &items[start..end] } else { &[] }))
        }
        "concat" => {
            let mut items = items_of(r);
            for a in args {
                match a {
                    Value::Object(o) if is_array(*o) => items.extend(items_of(*o)),
                    other => items.push(other.clone()),
                }
            }
            Ok(new_array(&items))
        }
        "indexOf" | "includes" => {
            let needle = arg(0);
            let items = items_of(r);
            let found = items.iter().position(|v| if name == "includes" { same_value_zero(v, &needle) } else { strict_equal(v, &needle) });
            Ok(if name == "includes" { Value::Bool(found.is_some()) } else { Value::Number(found.map_or(-1.0, |i| i as f64)) })
        }
        "at" => {
            let items = items_of(r);
            let i = match args.first() { Some(Value::Number(n)) if !n.is_nan() => n.trunc(), _ => 0.0 };
            let i = if i < 0.0 { items.len() as f64 + i } else { i };
            Ok(if i >= 0.0 && (i as usize) < items.len() { items[i as usize].clone() } else { Value::Undefined })
        }
        "join" | "toString" => {
            let sep = match args.first() { Some(Value::Str(s)) if name == "join" => s.clone(), _ => ",".into() };
            let parts: Vec<String> = items_of(r).iter().map(|v| match v { Value::Undefined | Value::Null => String::new(), v => objects::to_display(v) }).collect();
            Ok(Value::Str(parts.join(&sep)))
        }
        "reverse" => {
            with(r, |d| if let Data::Array(items, _) = d { items.reverse() });
            Ok(Value::Object(r))
        }
        "forEach" => each(&arg(0), Box::new(|_, _, _| true)).map(|()| Value::Undefined),
        // Iterators over the array as it is now (a browser's walk the live array; the loops that take these do not
        // change it as they go). Fresh pairs drop their own counts when the operation ends: the iterator's hold keeps
        // them, as URLSearchParams.entries does.
        "keys" => Ok(new_snapshot_iterator((0..items_of(r).len()).map(|i| Value::Number(i as f64)).collect())),
        "values" => Ok(new_snapshot_iterator(items_of(r))),
        "entries" => Ok(new_snapshot_iterator(items_of(r).into_iter().enumerate().map(|(i, v)| new_array(&[Value::Number(i as f64), v])).collect())),
        "map" => {
            let mut out = Vec::new();
            each(&arg(0), Box::new(|_, _, result| { retain_value(&result); out.push(result); true }))?;
            let arr = new_array(&out);
            for v in out { release_value(v) }
            Ok(arr)
        }
        "filter" => {
            let mut out = Vec::new();
            each(&arg(0), Box::new(|_, v, result| { if truthy(&result) { out.push(v.clone()) } true }))?;
            Ok(new_array(&out))
        }
        "find" | "findIndex" => {
            let mut hit = None;
            each(&arg(0), Box::new(|i, v, result| if truthy(&result) { hit = Some((i, v.clone())); false } else { true }))?;
            Ok(match (name, hit) {
                ("find", Some((_, v))) => v,
                ("find", None) => Value::Undefined,
                (_, Some((i, _))) => Value::Number(i as f64),
                _ => Value::Number(-1.0),
            })
        }
        "some" | "every" => {
            let every = name == "every";
            let mut answer = every;
            each(&arg(0), Box::new(|_, _, result| if truthy(&result) != every { answer = !every; false } else { true }))?;
            Ok(Value::Bool(answer))
        }
        "reduce" => {
            let f = arg(0);
            if !callable(&f) {
                return Err(format!("{} is not a function", objects::to_display(&f)));
            }
            let items = items_of(r);
            let (mut acc, start) = match args.get(1) {
                Some(init) => (init.clone(), 0),
                None if items.is_empty() => return Err("Reduce of empty array with no initial value".into()),
                None => (items[0].clone(), 1),
            };
            retain_value(&acc);
            for (i, v) in items.iter().enumerate().skip(start) {
                let next = call_value(&f, None, &[acc.clone(), v.clone(), Value::Number(i as f64), Value::Object(r)]);
                let next = match next { Ok(n) => n, Err(e) => { release_value(acc); return Err(e) } };
                retain_value(&next);
                release_value(std::mem::replace(&mut acc, next));
            }
            objects::release_value_after_return(acc.clone());
            Ok(acc)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

fn bytes_method(r: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    let (elem, data) = bytes_of(r).ok_or("not a typed array")?;
    let size = elem_size(elem);
    let len = data.len() / size;
    match name {
        // A subarray is a copy here (no shared views across the boundary yet), like slice.
        "slice" | "subarray" => {
            let start = rel_index(args.first(), len, 0);
            let end = rel_index(args.get(1), len, len);
            Ok(new_bytes(elem, if start < end { data[start * size..end * size].to_vec() } else { Vec::new() }))
        }
        "fill" => {
            let n = match args.first() { Some(Value::Number(n)) => *n, _ => 0.0 };
            let start = rel_index(args.get(1), len, 0);
            let end = rel_index(args.get(2), len, len);
            with(r, |d| if let Data::Bytes { elem, data, .. } = d {
                for i in start..end.max(start) { write_elem(*elem, &mut data[i * size..(i + 1) * size], n) }
            });
            Ok(Value::Object(r))
        }
        "set" => {
            let offset = rel_index(args.get(1), len, 0);
            let source: Vec<f64> = match args.first() {
                Some(Value::Object(o)) if is_array(*o) => items_of(*o).iter().map(|v| match v { Value::Number(n) => *n, _ => f64::NAN }).collect(),
                Some(Value::Object(o)) => match bytes_of(*o) {
                    Some((e, d)) => d.chunks(elem_size(e)).map(|c| read_elem(e, c)).collect(),
                    None => return Err("set: the source is not an array or typed array".into()),
                },
                _ => return Err("set: the source is not an array or typed array".into()),
            };
            if offset + source.len() > len {
                return Err("offset is out of bounds".into());
            }
            with(r, |d| if let Data::Bytes { elem, data, .. } = d {
                for (i, n) in source.iter().enumerate() { write_elem(*elem, &mut data[(offset + i) * size..(offset + i + 1) * size], *n) }
            });
            Ok(Value::Undefined)
        }
        "toString" => Ok(Value::Str(data.chunks(size).map(|c| objects::number_to_string(read_elem(elem, c))).collect::<Vec<_>>().join(","))),
        _ => Err(format!("{name} is not a function")),
    }
}

/// GetIterator over a host value: arrays (live), typed arrays (snapshot), an iterator (itself).
pub fn iterator(r: u64) -> Option<Value> {
    enum K { Array, Bytes(u32, Vec<u8>), Iterator }
    let kind = with(r, |d| match d {
        Data::Array(..) => Some(K::Array),
        Data::Bytes { elem, data, .. } => Some(K::Bytes(*elem, data.clone())),
        Data::Iterator { .. } => Some(K::Iterator),
        _ => None,
    })
    .flatten()?;
    Some(match kind {
        K::Array => {
            objects::retain(r);
            alloc(Data::Iterator { array: Some(r), items: Vec::new(), index: 0 })
        }
        K::Bytes(elem, data) => new_snapshot_iterator(data.chunks(elem_size(elem)).map(|c| Value::Number(read_elem(elem, c))).collect()),
        K::Iterator => Value::Object(r),
    })
}

// ── promises ─────────────────────────────────────────────────────────────

fn promise_method(r: u64, name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).cloned().filter(callable).unwrap_or(Value::Undefined);
    let derived = new_promise();
    let Value::Object(d) = derived else { unreachable!() };
    objects::retain(d);
    let reaction = match name {
        "then" => Reaction::Then { on_ok: kept(&arg(0)), on_err: kept(&arg(1)), derived: d },
        "catch" => Reaction::Then { on_ok: Value::Undefined, on_err: kept(&arg(0)), derived: d },
        "finally" => Reaction::Finally { f: kept(&arg(0)), derived: d },
        _ => {
            objects::release(d);
            return Err(format!("{name} is not a function"));
        }
    };
    react(r, reaction);
    Ok(derived)
}

/// Adds a reaction to promise `r`: queued now when it already settled.
fn react(r: u64, reaction: Reaction) {
    let queued = with(r, |d| match d {
        Data::Promise(p) => match &p.settled {
            Some((rejected, v)) => Some((reaction, *rejected, kept(v))),
            None => { p.reactions.push(reaction); None }
        },
        _ => Some((reaction, false, Value::Undefined)),
    })
    .flatten();
    if let Some(job) = queued {
        JOBS.with(|j| j.borrow_mut().push_back(job));
    }
}

/// A native subscriber to promise `r`: false when `r` is no promise.
pub fn subscribe(r: u64, settled: Settled, ctx: usize) -> bool {
    if !is_promise(r) {
        return false;
    }
    react(r, Reaction::Native { settled, ctx });
    true
}

/// Resolves (or rejects) promise `r` with `value` (borrowed): the first settlement wins; fulfilling with another
/// host promise adopts its state.
pub fn settle(r: u64, rejected: bool, value: &Value) {
    if !rejected {
        if let Value::Object(other) = value {
            if *other == r {
                let err = new_error("TypeError", "Chaining cycle detected for promise #<Promise>");
                settle(r, true, &err);
                return;
            }
            if is_promise(*other) {
                objects::retain(r);
                react(*other, Reaction::Adopt { target: r });
                return;
            }
        }
    }
    let reactions = with(r, |d| match d {
        Data::Promise(p) if p.settled.is_none() => {
            p.settled = Some((rejected, kept(value)));
            std::mem::take(&mut p.reactions)
        }
        _ => Vec::new(),
    })
    .unwrap_or_default();
    JOBS.with(|j| {
        let mut j = j.borrow_mut();
        for reaction in reactions {
            j.push_back((reaction, rejected, kept(value)));
        }
    });
}

pub fn jobs_pending() -> bool {
    JOBS.with(|j| !j.borrow().is_empty())
}

/// Runs the promise reactions due now (and those they queue), in order.
pub fn run_jobs() {
    while let Some((reaction, rejected, value)) = JOBS.with(|j| j.borrow_mut().pop_front()) {
        match reaction {
            Reaction::Then { on_ok, on_err, derived } => {
                let handler = if rejected { &on_err } else { &on_ok };
                if callable(handler) {
                    run_handler(handler, &[value.clone()], derived, None);
                } else {
                    settle(derived, rejected, &value);
                }
                release_value(on_ok);
                release_value(on_err);
                objects::release(derived);
            }
            Reaction::Finally { f, derived } => {
                if callable(&f) {
                    run_handler(&f, &[], derived, Some((rejected, &value)));
                } else {
                    settle(derived, rejected, &value);
                }
                release_value(f);
                objects::release(derived);
            }
            Reaction::Native { settled, ctx } => {
                let wire = abi::to_wire_borrowed(&value);
                unsafe { settled(ctx as *mut std::ffi::c_void, rejected as i32, &wire) };
            }
            Reaction::Adopt { target } => {
                settle(target, rejected, &value);
                objects::release(target);
            }
        }
        release_value(value);
        objects::settle();
    }
}

/// Runs a reaction's handler and settles the derived promise with its outcome (a throw rejects it); `finally`
/// passes the original settlement through.
fn run_handler(f: &Value, args: &[Value], derived: u64, pass: Option<(bool, &Value)>) {
    match call_value(f, None, args) {
        Ok(result) => match pass {
            Some((rejected, original)) => settle(derived, rejected, original),
            None => settle(derived, false, &result),
        },
        Err(message) => {
            let reason = abi::take_exception().unwrap_or_else(|| new_error("TypeError", &message));
            settle(derived, true, &reason);
            release_value(reason);
        }
    }
}

// ── display ──────────────────────────────────────────────────────────────

/// A value as console.log prints it (Node's util.inspect, single-line): strings quoted inside containers.
pub fn inspect(v: &Value, depth: usize) -> Option<String> {
    let Value::Object(r) = v else { return None };
    let nested = |x: &Value| match x {
        Value::Str(s) => format!("'{}'", s.replace('\'', "\\'")),
        // Node's default depth: containers nested deeper than two levels print as [Array] / [Object].
        Value::Object(o) if depth >= 2 && is_array(*o) => "[Array]".into(),
        Value::Object(o) if depth >= 2 && with(*o, |_| ()).is_some() => "[Object]".into(),
        x => inspect(x, depth + 1).unwrap_or_else(|| objects::to_display(x)),
    };
    enum K { Object(bool), Array, Bytes(u32, Vec<u8>), Promise, Iterator }
    let kind = with(*r, |d| match d {
        Data::Object { error, .. } => K::Object(*error),
        Data::Array(..) => K::Array,
        Data::Bytes { elem, data, .. } => K::Bytes(*elem, data.clone()),
        Data::Promise(_) => K::Promise,
        Data::Iterator { .. } => K::Iterator,
    })?;
    let list = |parts: Vec<String>, open: &str, close: &str| if parts.is_empty() { format!("{open}{close}") } else { format!("{open} {} {close}", parts.join(", ")) };
    Some(match kind {
        K::Object(true) => call_method(*r, "toString", &[]).map(|s| objects::to_display(&s)).unwrap_or_default(),
        // A compiled program's error, crossed as its checked-dynamic view (the runtime's `%error` marker): its stack,
        // as Node prints an error, else its name and message.
        K::Object(false) if get(*r, "%error").ok().flatten().is_some() => match get_or_undefined(*r, "stack") {
            Value::Str(stack) => stack,
            _ => {
                let text = |k: &str| match get_or_undefined(*r, k) {
                    Value::Str(s) => s,
                    _ => String::new(),
                };
                let name = text("name");
                format!("{}: {}", if name.is_empty() { "Error" } else { &name }, text("message"))
            }
        },
        K::Object(false) => {
            let parts = own_keys(*r)
                .into_iter()
                .map(|k| {
                    let shown = if k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') && !k.starts_with(|c: char| c.is_ascii_digit()) { k.clone() } else { format!("'{k}'") };
                    let value = match with(*r, |d| match d { Data::Object { props, .. } => props.iter().find(|p| p.key == k).map(|p| matches!(p.slot, Slot::Getter(_))), _ => None }).flatten() {
                        Some(true) => "[Getter]".into(),
                        _ => nested(&get_or_undefined(*r, &k)),
                    };
                    format!("{shown}: {value}")
                })
                .collect();
            list(parts, "{", "}")
        }
        K::Array => list(items_of(*r).iter().map(nested).collect(), "[", "]"),
        K::Bytes(elem, data) => {
            let size = elem_size(elem);
            let parts = data.chunks(size).map(|c| objects::number_to_string(read_elem(elem, c))).collect();
            format!("{}({}) {}", elem_name(elem), data.len() / size, list(parts, "[", "]"))
        }
        K::Promise => "Promise { <pending> }".into(),
        K::Iterator => "Object [Array Iterator] {}".into(),
    })
}

/// `String(v)` of a plain value (Array.prototype.toString, Error.prototype.toString, ...).
pub fn display(r: u64) -> Option<String> {
    enum K { Object, Array, Bytes, Promise, Iterator }
    let kind = with(r, |d| match d {
        Data::Object { .. } => K::Object,
        Data::Array(..) => K::Array,
        Data::Bytes { .. } => K::Bytes,
        Data::Promise(_) => K::Promise,
        Data::Iterator { .. } => K::Iterator,
    })?;
    Some(match kind {
        K::Object | K::Array | K::Bytes => call_method(r, "toString", &[]).map(|s| objects::to_display(&s)).unwrap_or_default(),
        K::Promise => "[object Promise]".into(),
        K::Iterator => "[object Array Iterator]".into(),
    })
}

// ── JSON and the Object / Array statics ──────────────────────────────────

fn json_quote(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// SerializeJSONProperty: Ok(false) when the value writes nothing (undefined, a function).
fn json_put(v: &Value, key: &str, indent: &str, depth: usize, stack: &mut Vec<u64>, out: &mut String) -> Result<bool, String> {
    match v {
        Value::Undefined | Value::Closure(_) => return Ok(false),
        // The program's own value: only the program can serialize it.
        Value::Program(_) => return Err("JSON.stringify: a compiled value handed to the host by reference cannot be serialized here".into()),
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) if n.is_finite() => out.push_str(&objects::number_to_string(*n)),
        Value::Number(_) => out.push_str("null"),
        Value::Str(s) => json_quote(s, out),
        Value::Object(r) => {
            if objects::is_callable(*r) {
                return Ok(false);
            }
            let to_json = if objects::is_value(*r) { get(*r, "toJSON")?.filter(callable) } else { None };
            if let Some(f) = to_json {
                let converted = call_value(&f, Some(*r), &[Value::Str(key.into())])?;
                retain_value(&converted);
                let put = json_put(&converted, key, indent, depth, stack, out);
                release_value(converted);
                return put;
            }
            if stack.contains(r) {
                return Err("Converting circular structure to JSON".into());
            }
            stack.push(*r);
            let newline = |out: &mut String, d: usize| if !indent.is_empty() { out.push('\n'); out.push_str(&indent.repeat(d)) };
            if is_array(*r) {
                let items = items_of(*r);
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 { out.push(',') }
                    newline(out, depth + 1);
                    if !json_put(item, &i.to_string(), indent, depth + 1, stack, out)? {
                        out.push_str("null");
                    }
                }
                if !items.is_empty() { newline(out, depth) }
                out.push(']');
            } else {
                out.push('{');
                let mut first = true;
                for k in objects::own_keys(*r) {
                    let mark = out.len();
                    if !first { out.push(',') }
                    newline(out, depth + 1);
                    json_quote(&k, out);
                    out.push(':');
                    if !indent.is_empty() { out.push(' ') }
                    let member = get_or_undefined(*r, &k);
                    if json_put(&member, &k, indent, depth + 1, stack, out)? { first = false } else { out.truncate(mark) }
                }
                if !first { newline(out, depth) }
                out.push('}');
            }
            stack.pop();
        }
    }
    Ok(true)
}

/// JSON.stringify(value, replacer, space): undefined when the value writes nothing. A replacer is refused.
pub fn json_stringify(args: &[Value]) -> Result<Value, String> {
    if matches!(args.get(1), Some(v) if !matches!(v, Value::Undefined | Value::Null)) {
        return Err("JSON.stringify: a replacer is not supported by the host island yet".into());
    }
    let indent = match args.get(2) {
        Some(Value::Number(n)) => " ".repeat(n.clamp(0.0, 10.0) as usize),
        Some(Value::Str(s)) => s.chars().take(10).collect(),
        _ => String::new(),
    };
    let mut out = String::new();
    let v = args.first().cloned().unwrap_or(Value::Undefined);
    Ok(if json_put(&v, "", &indent, 0, &mut Vec::new(), &mut out)? { Value::Str(out) } else { Value::Undefined })
}

struct Parser<'a> {
    s: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.at < self.s.len() && matches!(self.s[self.at], b' ' | b'\t' | b'\n' | b'\r') {
            self.at += 1;
        }
    }

    fn fail<T>(&self) -> Result<T, String> {
        match self.s.get(self.at) {
            None => Err("Unexpected end of JSON input".into()),
            Some(c) => Err(format!("Unexpected token '{}', \"{}\" is not valid JSON", *c as char, String::from_utf8_lossy(self.s))),
        }
    }

    fn eat(&mut self, c: u8) -> bool {
        self.ws();
        if self.s.get(self.at) == Some(&c) { self.at += 1; true } else { false }
    }

    /// A parsed value; composites come back with one count held (the caller's).
    fn value(&mut self) -> Result<Value, String> {
        self.ws();
        match self.s.get(self.at) {
            Some(b'{') => {
                self.at += 1;
                let obj = new_object();
                let Value::Object(r) = obj else { unreachable!() };
                objects::retain(r);
                if !self.eat(b'}') {
                    loop {
                        self.ws();
                        if self.s.get(self.at) != Some(&b'"') { release_value(obj); return self.fail() }
                        let key = match self.string() { Ok(k) => k, Err(e) => { release_value(obj); return Err(e) } };
                        if !self.eat(b':') { release_value(obj); return self.fail() }
                        let v = match self.value() { Ok(v) => v, Err(e) => { release_value(obj); return Err(e) } };
                        let _ = set(r, &key, v.clone());
                        release_value(v);
                        if self.eat(b',') { continue }
                        if self.eat(b'}') { break }
                        release_value(obj);
                        return self.fail();
                    }
                }
                Ok(obj)
            }
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                let done = |items: Vec<Value>| { for v in items { release_value(v) } };
                if !self.eat(b']') {
                    loop {
                        match self.value() { Ok(v) => items.push(v), Err(e) => { done(items); return Err(e) } }
                        if self.eat(b',') { continue }
                        if self.eat(b']') { break }
                        done(items);
                        return self.fail();
                    }
                }
                let arr = new_array(&items);
                if let Value::Object(r) = arr { objects::retain(r) }
                done(items);
                Ok(arr)
            }
            Some(b'"') => self.string().map(Value::Str),
            Some(b't') if self.s[self.at..].starts_with(b"true") => { self.at += 4; Ok(Value::Bool(true)) }
            Some(b'f') if self.s[self.at..].starts_with(b"false") => { self.at += 5; Ok(Value::Bool(false)) }
            Some(b'n') if self.s[self.at..].starts_with(b"null") => { self.at += 4; Ok(Value::Null) }
            Some(c) if *c == b'-' || c.is_ascii_digit() => {
                let start = self.at;
                while self.at < self.s.len() && matches!(self.s[self.at], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    self.at += 1;
                }
                let text = std::str::from_utf8(&self.s[start..self.at]).unwrap_or("");
                text.parse::<f64>().map(Value::Number).or_else(|_| { self.at = start; self.fail() })
            }
            _ => self.fail(),
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.at += 1; // the opening quote
        let mut out: Vec<u16> = Vec::new();
        let mut bytes = Vec::new();
        let flush = |bytes: &mut Vec<u8>, out: &mut Vec<u16>| { out.extend(String::from_utf8_lossy(bytes).encode_utf16()); bytes.clear() };
        loop {
            let Some(&c) = self.s.get(self.at) else { return self.fail() };
            self.at += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    flush(&mut bytes, &mut out);
                    let Some(&e) = self.s.get(self.at) else { return self.fail() };
                    self.at += 1;
                    match e {
                        b'"' => out.push(b'"' as u16),
                        b'\\' => out.push(b'\\' as u16),
                        b'/' => out.push(b'/' as u16),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(10),
                        b'r' => out.push(13),
                        b't' => out.push(9),
                        b'u' => {
                            let hex = self.s.get(self.at..self.at + 4).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u16::from_str_radix(h, 16).ok());
                            let Some(unit) = hex else { return self.fail() };
                            self.at += 4;
                            out.push(unit);
                        }
                        _ => { self.at -= 1; return self.fail() }
                    }
                }
                c if c < 0x20 => { self.at -= 1; return self.fail() }
                c => bytes.push(c),
            }
        }
        flush(&mut bytes, &mut out);
        Ok(String::from_utf16_lossy(&out))
    }
}

/// JSON.parse(text): a fresh value, or Err with the SyntaxError's message. A reviver is refused.
pub fn json_parse(args: &[Value]) -> Result<Value, (String, &'static str)> {
    if matches!(args.get(1), Some(v) if callable(v)) {
        return Err(("JSON.parse: a reviver is not supported by the host island yet".into(), "TypeError"));
    }
    let text = args.first().map(objects::to_display).unwrap_or_else(|| "undefined".into());
    let mut p = Parser { s: text.as_bytes(), at: 0 };
    let v = p.value().map_err(|m| (m, "SyntaxError"))?;
    p.ws();
    if p.at != p.s.len() {
        release_value(v);
        return p.fail().map_err(|m| (m, "SyntaxError"));
    }
    // The parse's own count becomes the operation's, dropped once the result is out.
    objects::release_value_after_return(v.clone());
    Ok(v)
}

/// Object.keys / values / entries / assign / freeze, Array.isArray / of / from over host values.
pub fn builtin_call(object: &str, name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Undefined);
    let target = |v: &Value| match v {
        Value::Object(r) => Ok(*r),
        Value::Undefined | Value::Null => Err("Cannot convert undefined or null to object".to_string()),
        _ => Err(format!("{object}.{name} on a primitive is not supported by the host island")),
    };
    match (object, name) {
        ("Object", "keys" | "values" | "entries") => {
            let r = target(&arg(0))?;
            let keys = objects::own_keys(r);
            let mut items = Vec::new();
            for k in keys {
                let item = match name {
                    "keys" => Value::Str(k),
                    "values" => objects::get(r, &k)?,
                    _ => {
                        let v = objects::get(r, &k)?;
                        new_array(&[Value::Str(k), v])
                    }
                };
                items.push(item);
            }
            Ok(new_array(&items))
        }
        ("Object", "assign") => {
            let r = target(&arg(0))?;
            for src in args.iter().skip(1) {
                if let Value::Object(s) = src {
                    for k in objects::own_keys(*s) {
                        let v = objects::get(*s, &k)?;
                        objects::set(r, &k, v)?;
                    }
                }
            }
            Ok(Value::Object(r))
        }
        // Freezing is not modelled: the value comes back as is.
        ("Object", "freeze" | "seal" | "preventExtensions") => Ok(arg(0)),
        ("Object", "hasOwn") => Ok(Value::Bool(has_own(target(&arg(0))?, &objects::to_display(&arg(1))))),
        ("Array", "isArray") => Ok(Value::Bool(matches!(arg(0), Value::Object(r) if is_array(r)))),
        ("Array", "of") => Ok(new_array(args)),
        ("Array", "from") => match arg(0) {
            Value::Object(r) if is_array(r) => Ok(new_array(&items_of(r))),
            Value::Object(r) => match iterator(r) {
                Some(Value::Object(it)) => {
                    let mut items = Vec::new();
                    loop {
                        let step = call_method(it, "next", &[])?;
                        let Value::Object(s) = step else { break };
                        if truthy(&get_or_undefined(s, "done")) { break }
                        items.push(get_or_undefined(s, "value"));
                    }
                    Ok(new_array(&items))
                }
                _ => Ok(new_array(&[])),
            },
            Value::Str(s) => Ok(new_array(&s.chars().map(|c| Value::Str(c.to_string())).collect::<Vec<_>>())),
            _ => Ok(new_array(&[])),
        },
        _ => Err(format!("{object}.{name} is not a function")),
    }
}
