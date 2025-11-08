//! Engram FFI
//!
//! Exposes the archive reader and SQLite helper functionality via a C ABI that
//! can be consumed from Java (FFM), Python, or any other language capable of
//! interoperating with C.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::panic::{self, AssertUnwindSafe};
use std::ptr;
use std::sync::{Arc, Mutex};

use engram_rs::{ArchiveReader, CompressionMethod, EngramVfs};
use rusqlite::Connection;
use serde_json::json;

/// Opaque handle types exposed through the C API.
#[repr(C)]
pub struct EngramArchiveHandle {
    reader: Arc<Mutex<ArchiveReader>>,
    path: String,
}

#[repr(C)]
pub struct EngramDatabaseHandle {
    conn: Arc<Mutex<Connection>>,
}

/// Byte buffer returned to foreign callers.
#[repr(C)]
pub struct EngramBuffer {
    pub data: *mut u8,
    pub len: usize,
}

/// List of strings (UTF-8). Caller must free via `engram_string_list_free`.
#[repr(C)]
pub struct EngramStringList {
    pub data: *mut *mut c_char,
    pub len: usize,
}

const OK: c_int = 0;
const ERR: c_int = 1;
const PANIC: c_int = -1;

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

fn set_error(out_error: *mut *mut c_char, message: impl ToString) {
    if out_error.is_null() {
        return;
    }

    // Safety: caller promises `out_error` is a valid mutable pointer.
    unsafe {
        if !(*out_error).is_null() {
            // Free any existing message to avoid leaks.
            drop(CString::from_raw(*out_error));
            *out_error = ptr::null_mut();
        }

        let cstring = match CString::new(message.to_string()) {
            Ok(s) => s,
            Err(_) => CString::new("Failed to allocate error message").unwrap(),
        };

        *out_error = cstring.into_raw();
    }
}

fn ffi_guard<F>(out_error: *mut *mut c_char, f: F) -> c_int
where
    F: FnOnce() -> Result<(), String>,
{
    match panic::catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => OK,
        Ok(Err(err)) => {
            set_error(out_error, err);
            ERR
        }
        Err(_) => {
            set_error(out_error, "internal panic in engram-ffi");
            PANIC
        }
    }
}

unsafe fn cstr_to_string(ptr: *const c_char) -> Result<String, String> {
    if ptr.is_null() {
        return Err("received null pointer for string".to_string());
    }
    CStr::from_ptr(ptr)
        .to_str()
        .map(|s| s.to_string())
        .map_err(|e| format!("invalid UTF-8: {e}"))
}

// -------------------------------------------------------------------------------------------------
// Archive functions
// -------------------------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn engram_open_archive(
    path: *const c_char,
    out_handle: *mut *mut EngramArchiveHandle,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if out_handle.is_null() {
            return Err("out_handle pointer cannot be null".into());
        }

        let path_str = unsafe { cstr_to_string(path)? };
        let reader = ArchiveReader::open(&path_str)
            .map_err(|e| format!("failed to open archive: {e}"))?;

        let handle = EngramArchiveHandle {
            reader: Arc::new(Mutex::new(reader)),
            path: path_str,
        };

        unsafe {
            *out_handle = Box::into_raw(Box::new(handle));
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_close_archive(handle: *mut EngramArchiveHandle) {
    if handle.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub extern "C" fn engram_archive_entry_count(
    handle: *mut EngramArchiveHandle,
    out_count: *mut u32,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_count.is_null() {
            return Err("null pointer passed to entry_count".into());
        }

        let archive = unsafe { &*handle };
        let reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        unsafe {
            *out_count = reader.entry_count() as u32;
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_contains(
    handle: *mut EngramArchiveHandle,
    path: *const c_char,
    out_result: *mut bool,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_result.is_null() {
            return Err("null pointer passed to contains".into());
        }

        let query_path = unsafe { cstr_to_string(path)? };
        let archive = unsafe { &*handle };
        let reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        unsafe {
            *out_result = reader.contains(&query_path);
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_list_files(
    handle: *mut EngramArchiveHandle,
    out_list: *mut EngramStringList,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_list.is_null() {
            return Err("null pointer passed to list_files".into());
        }

        let archive = unsafe { &*handle };
        let reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let mut strings: Vec<*mut c_char> = Vec::with_capacity(reader.list_files().len());
        for file in reader.list_files() {
            let cstring = CString::new(file.as_str())
                .map_err(|_| format!("file path contains interior null byte: {file}"))?;
            strings.push(cstring.into_raw());
        }

        let len = strings.len();
        let data_ptr = if len == 0 {
            ptr::null_mut()
        } else {
            let boxed = strings.into_boxed_slice();
            Box::into_raw(boxed) as *mut *mut c_char
        };

        unsafe {
            (*out_list).data = data_ptr;
            (*out_list).len = len;
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_read_file(
    handle: *mut EngramArchiveHandle,
    path: *const c_char,
    out_buffer: *mut EngramBuffer,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_buffer.is_null() {
            return Err("null pointer passed to read_file".into());
        }

        let query_path = unsafe { cstr_to_string(path)? };
        let archive = unsafe { &*handle };

        let mut reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let data = reader
            .read_file(&query_path)
            .map_err(|e| format!("failed to read file: {e}"))?;

        let len = data.len();
        let mut boxed = data.into_boxed_slice();
        let data_ptr = boxed.as_mut_ptr();
        std::mem::forget(boxed);

        unsafe {
            (*out_buffer).data = data_ptr;
            (*out_buffer).len = len;
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_read_text(
    handle: *mut EngramArchiveHandle,
    path: *const c_char,
    out_text: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_text.is_null() {
            return Err("null pointer passed to read_text".into());
        }

        let query_path = unsafe { cstr_to_string(path)? };
        let archive = unsafe { &*handle };
        let mut reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let data = reader
            .read_file(&query_path)
            .map_err(|e| format!("failed to read file: {e}"))?;

        let text = String::from_utf8(data).map_err(|e| format!("utf-8 error: {e}"))?;
        let cstring = CString::new(text).map_err(|e| format!("failed to convert text: {e}"))?;

        unsafe {
            *out_text = cstring.into_raw();
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_read_json(
    handle: *mut EngramArchiveHandle,
    path: *const c_char,
    out_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_json.is_null() {
            return Err("null pointer passed to read_json".into());
        }

        let query_path = unsafe { cstr_to_string(path)? };
        let archive = unsafe { &*handle };
        let mut reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let data = reader
            .read_file(&query_path)
            .map_err(|e| format!("failed to read file: {e}"))?;

        let json_value: serde_json::Value =
            serde_json::from_slice(&data).map_err(|e| format!("invalid JSON: {e}"))?;

        let json = serde_json::to_string(&json_value)
            .map_err(|e| format!("failed to serialize JSON: {e}"))?;

        let cstring = CString::new(json).map_err(|e| format!("failed to convert JSON: {e}"))?;

        unsafe {
            *out_json = cstring.into_raw();
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_get_metadata(
    handle: *mut EngramArchiveHandle,
    path: *const c_char,
    out_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_json.is_null() {
            return Err("null pointer passed to get_metadata".into());
        }

        let query_path = unsafe { cstr_to_string(path)? };
        let archive = unsafe { &*handle };
        let reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let entry = reader
            .get_entry(&query_path)
            .ok_or_else(|| format!("entry not found: {query_path}"))?;

        let metadata = json!({
            "path": entry.path,
            "uncompressedSize": entry.uncompressed_size,
            "compressedSize": entry.compressed_size,
            "compression": match entry.compression {
                CompressionMethod::None => "none",
                CompressionMethod::Lz4 => "lz4",
                CompressionMethod::Zstd => "zstd",
            },
            "modifiedTime": entry.modified_time,
            "crc32": entry.crc32,
        });

        let cstring = CString::new(
            serde_json::to_string(&metadata)
                .map_err(|e| format!("failed to serialize metadata: {e}"))?,
        )
        .map_err(|_| "metadata contains interior null byte".to_string())?;

        unsafe {
            *out_json = cstring.into_raw();
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_read_manifest(
    handle: *mut EngramArchiveHandle,
    out_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_json.is_null() {
            return Err("null pointer passed to read_manifest".into());
        }

        let archive = unsafe { &*handle };
        let mut reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let manifest = reader
            .read_manifest()
            .map_err(|e| format!("failed to read manifest: {e}"))?;

        let manifest_json = manifest
            .ok_or_else(|| "manifest.json not found in archive".to_string())?;

        let cstring = CString::new(
            serde_json::to_string(&manifest_json)
                .map_err(|e| format!("failed to serialize manifest: {e}"))?,
        )
        .map_err(|_| "manifest contains interior null byte".to_string())?;

        unsafe {
            *out_json = cstring.into_raw();
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_archive_list_prefix(
    handle: *mut EngramArchiveHandle,
    prefix: *const c_char,
    out_list: *mut EngramStringList,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_list.is_null() {
            return Err("null pointer passed to list_prefix".into());
        }

        let prefix_str = unsafe { cstr_to_string(prefix)? };
        let archive = unsafe { &*handle };
        let reader = archive
            .reader
            .lock()
            .map_err(|_| "reader poisoned".to_string())?;

        let matches = reader.list_prefix(&prefix_str);
        let mut strings: Vec<*mut c_char> = Vec::with_capacity(matches.len());
        for file in matches {
            let cstring = CString::new(file.as_str())
                .map_err(|_| format!("file path contains interior null byte: {file}"))?;
            strings.push(cstring.into_raw());
        }

        let len = strings.len();
        let data_ptr = if len == 0 {
            ptr::null_mut()
        } else {
            let boxed = strings.into_boxed_slice();
            Box::into_raw(boxed) as *mut *mut c_char
        };

        unsafe {
            (*out_list).data = data_ptr;
            (*out_list).len = len;
        }

        Ok(())
    })
}

// -------------------------------------------------------------------------------------------------
// SQLite database access
// -------------------------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn engram_archive_open_database(
    handle: *mut EngramArchiveHandle,
    db_path: *const c_char,
    out_db: *mut *mut EngramDatabaseHandle,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_db.is_null() {
            return Err("null pointer passed to open_database".into());
        }

        let db_path_str = unsafe { cstr_to_string(db_path)? };
        let archive = unsafe { &*handle };
        let vfs = EngramVfs::new(&archive.path);
        let conn = vfs
            .open_database(&db_path_str)
            .map_err(|e| format!("failed to open database: {e}"))?;

        let handle = EngramDatabaseHandle {
            conn: Arc::new(Mutex::new(conn)),
        };

        unsafe {
            *out_db = Box::into_raw(Box::new(handle));
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_database_close(handle: *mut EngramDatabaseHandle) {
    if handle.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub extern "C" fn engram_database_query(
    handle: *mut EngramDatabaseHandle,
    sql: *const c_char,
    params_json: *const c_char,
    out_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_json.is_null() {
            return Err("null pointer passed to database_query".into());
        }

        let sql_str = unsafe { cstr_to_string(sql)? };
        let params_str = if params_json.is_null() {
            None
        } else {
            Some(unsafe { cstr_to_string(params_json)? })
        };

        let db = unsafe { &*handle };
        let conn = db
            .conn
            .lock()
            .map_err(|_| "database connection poisoned".to_string())?;

        let mut stmt = conn
            .prepare(&sql_str)
            .map_err(|e| format!("failed to prepare statement: {e}"))?;

        let param_values: Vec<serde_json::Value> = if let Some(params) = params_str {
            serde_json::from_str(&params).map_err(|e| format!("failed to parse params: {e}"))?
        } else {
            Vec::new()
        };

        let sqlite_params: Vec<rusqlite::types::Value> =
            param_values.into_iter().map(json_to_sqlite_value).collect();

        let param_refs: Vec<&dyn rusqlite::ToSql> = sqlite_params
            .iter()
            .map(|v| v as &dyn rusqlite::ToSql)
            .collect();

        let column_count = stmt.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap().to_string())
            .collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut obj = serde_json::Map::new();
                for (index, name) in column_names.iter().enumerate() {
                    let value = sqlite_value_to_json(row, index)?;
                    obj.insert(name.clone(), value);
                }
                Ok(serde_json::Value::Object(obj))
            })
            .map_err(|e| format!("query failed: {e}"))?;

        let results: Vec<serde_json::Value> =
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("{e}"))?;

        let json = serde_json::to_string(&results)
            .map_err(|e| format!("failed to serialize results: {e}"))?;

        let cstring = CString::new(json).map_err(|_| "query results contain null byte".to_string())?;

        unsafe {
            *out_json = cstring.into_raw();
        }

        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn engram_database_execute(
    handle: *mut EngramDatabaseHandle,
    sql: *const c_char,
    params_json: *const c_char,
    out_rows: *mut i64,
    out_error: *mut *mut c_char,
) -> c_int {
    ffi_guard(out_error, || {
        if handle.is_null() || out_rows.is_null() {
            return Err("null pointer passed to database_execute".into());
        }

        let sql_str = unsafe { cstr_to_string(sql)? };
        let params_str = if params_json.is_null() {
            None
        } else {
            Some(unsafe { cstr_to_string(params_json)? })
        };

        let db = unsafe { &*handle };
        let conn = db
            .conn
            .lock()
            .map_err(|_| "database connection poisoned".to_string())?;

        let param_values: Vec<serde_json::Value> = if let Some(params) = params_str {
            serde_json::from_str(&params).map_err(|e| format!("failed to parse params: {e}"))?
        } else {
            Vec::new()
        };

        let sqlite_params: Vec<rusqlite::types::Value> =
            param_values.into_iter().map(json_to_sqlite_value).collect();

        let param_refs: Vec<&dyn rusqlite::ToSql> = sqlite_params
            .iter()
            .map(|v| v as &dyn rusqlite::ToSql)
            .collect();

        let changed = conn
            .execute(&sql_str, param_refs.as_slice())
            .map_err(|e| format!("execute failed: {e}"))?;

        unsafe {
            *out_rows = changed as i64;
        }

        Ok(())
    })
}

// -------------------------------------------------------------------------------------------------
// Memory helpers for foreign callers
// -------------------------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn engram_free_cstring(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }

    unsafe {
        drop(CString::from_raw(ptr));
    }
}

#[no_mangle]
pub extern "C" fn engram_buffer_free(buffer: EngramBuffer) {
    if buffer.data.is_null() || buffer.len == 0 {
        return;
    }

    unsafe {
        Vec::from_raw_parts(buffer.data, buffer.len, buffer.len);
    }
}

#[no_mangle]
pub extern "C" fn engram_string_list_free(list: EngramStringList) {
    if list.data.is_null() {
        return;
    }

    unsafe {
        let slice = std::slice::from_raw_parts_mut(list.data, list.len);
        for ptr in slice {
            if !ptr.is_null() {
                drop(CString::from_raw(*ptr));
            }
        }
        drop(Box::from_raw(list.data));
    }
}

// -------------------------------------------------------------------------------------------------
// Helpers reused from napi crate
// -------------------------------------------------------------------------------------------------

fn json_to_sqlite_value(value: serde_json::Value) -> rusqlite::types::Value {
    use rusqlite::types::Value;
    use serde_json::Value as JsonValue;

    match value {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Integer(if b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                Value::Null
            }
        }
        JsonValue::String(s) => Value::Text(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            Value::Text(serde_json::to_string(&value).unwrap())
        }
    }
}

fn sqlite_value_to_json(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<serde_json::Value> {
    use rusqlite::types::ValueRef;

    match row.get_ref(idx)? {
        ValueRef::Null => Ok(serde_json::Value::Null),
        ValueRef::Integer(i) => Ok(serde_json::json!(i)),
        ValueRef::Real(f) => Ok(serde_json::json!(f)),
        ValueRef::Text(s) => Ok(serde_json::json!(String::from_utf8_lossy(s))),
        ValueRef::Blob(b) => Ok(serde_json::json!(b)),
    }
}
