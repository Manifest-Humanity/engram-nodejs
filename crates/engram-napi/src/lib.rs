//! # Engram NAPI
//!
//! NAPI-RS bindings for accessing .eng archives from Node.js/TypeScript

use engram_rs::{ArchiveReader, ArchiveWriter, CompressionMethod as CoreCompressionMethod, EngramVfs};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

/// Compression method enum exposed to JavaScript
#[napi]
pub enum CompressionMethod {
    None,
    Lz4,
    Zstd,
}

impl From<CompressionMethod> for CoreCompressionMethod {
    fn from(method: CompressionMethod) -> Self {
        match method {
            CompressionMethod::None => CoreCompressionMethod::None,
            CompressionMethod::Lz4 => CoreCompressionMethod::Lz4,
            CompressionMethod::Zstd => CoreCompressionMethod::Zstd,
        }
    }
}

/// Archive entry metadata
#[napi(object)]
pub struct EntryMetadata {
    pub path: String,
    pub uncompressed_size: i64,
    pub compressed_size: i64,
    pub compression_method: String,
    pub modified_time: i64,
}

/// Engram archive reader for accessing files and databases
#[napi]
pub struct EngramArchive {
    inner: Arc<Mutex<ArchiveReader>>,
    path: String,
}

#[napi]
impl EngramArchive {
    /// Open an existing archive file
    #[napi(constructor)]
    pub fn new(path: String) -> Result<Self> {
        let reader = ArchiveReader::open(&path)
            .map_err(|e| Error::from_reason(format!("Failed to open archive: {}", e)))?;

        Ok(Self {
            inner: Arc::new(Mutex::new(reader)),
            path,
        })
    }

    /// Get the number of entries in the archive
    #[napi]
    pub fn entry_count(&self) -> Result<u32> {
        let reader = self.inner.lock().unwrap();
        Ok(reader.entry_count() as u32)
    }

    /// List all file paths in the archive
    #[napi]
    pub fn list_files(&self) -> Result<Vec<String>> {
        let reader = self.inner.lock().unwrap();
        Ok(reader.list_files().to_vec())
    }

    /// Check if a file exists in the archive
    #[napi]
    pub fn contains(&self, path: String) -> Result<bool> {
        let reader = self.inner.lock().unwrap();
        Ok(reader.contains(&path))
    }

    /// Get metadata for a file
    #[napi]
    pub fn get_metadata(&self, path: String) -> Result<Option<EntryMetadata>> {
        let reader = self.inner.lock().unwrap();
        match reader.get_entry(&path) {
            Some(entry) => Ok(Some(EntryMetadata {
                path: entry.path.clone(),
                uncompressed_size: entry.uncompressed_size as i64,
                compressed_size: entry.compressed_size as i64,
                compression_method: format!("{:?}", entry.compression),
                modified_time: entry.modified_time as i64,
            })),
            None => Ok(None),
        }
    }

    /// Read a file from the archive (synchronous)
    #[napi]
    pub fn read_file_sync(&self, path: String) -> Result<Buffer> {
        let mut reader = self.inner.lock().unwrap();
        let data = reader
            .read_file(&path)
            .map_err(|e| Error::from_reason(format!("Failed to read file: {}", e)))?;

        Ok(data.into())
    }

    /// Read a file from the archive (asynchronous)
    #[napi]
    pub async fn read_file(&self, path: String) -> Result<Buffer> {
        let inner = self.inner.clone();
        tokio::task::spawn_blocking(move || {
            let mut reader = inner.lock().unwrap();
            reader
                .read_file(&path)
                .map_err(|e| Error::from_reason(format!("Failed to read file: {}", e)))
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task failed: {}", e)))?
        .map(|v| v.into())
    }

    /// Read multiple files from the archive (batch operation)
    #[napi]
    pub async fn read_files(&self, paths: Vec<String>) -> Result<Vec<Buffer>> {
        let inner = self.inner.clone();
        tokio::task::spawn_blocking(move || {
            let mut reader = inner.lock().unwrap();
            let mut results = Vec::with_capacity(paths.len());

            for path in paths {
                let data = reader
                    .read_file(&path)
                    .map_err(|e| Error::from_reason(format!("Failed to read {}: {}", path, e)))?;
                results.push(data.into());
            }

            Ok(results)
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task failed: {}", e)))?
    }

    /// Read and parse manifest.json (returns JSON string)
    #[napi]
    pub fn read_manifest(&self) -> Result<Option<String>> {
        let mut reader = self.inner.lock().unwrap();
        let manifest = reader
            .read_manifest()
            .map_err(|e| Error::from_reason(format!("Failed to read manifest: {}", e)))?;

        match manifest {
            Some(value) => {
                let json_str = serde_json::to_string(&value)
                    .map_err(|e| Error::from_reason(format!("Failed to serialize manifest: {}", e)))?;
                Ok(Some(json_str))
            }
            None => Ok(None),
        }
    }

    /// List files with a given prefix
    #[napi]
    pub fn list_prefix(&self, prefix: String) -> Result<Vec<String>> {
        let reader = self.inner.lock().unwrap();
        Ok(reader.list_prefix(&prefix).into_iter().map(|s| s.clone()).collect())
    }

    /// Open a SQLite database from the archive
    #[napi]
    pub fn open_database(&self, db_path: String) -> Result<EngramDatabase> {
        let vfs = EngramVfs::new(&self.path);
        let conn = vfs
            .open_database(&db_path)
            .map_err(|e| Error::from_reason(format!("Failed to open database: {}", e)))?;

        Ok(EngramDatabase {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

/// SQLite database connection from archive
#[napi]
pub struct EngramDatabase {
    conn: Arc<Mutex<Connection>>,
}

#[napi]
impl EngramDatabase {
    /// Execute a query and return results as JSON string
    #[napi]
    pub fn query(&self, sql: String, params: Option<String>) -> Result<String> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| Error::from_reason(format!("Failed to prepare statement: {}", e)))?;

        // Parse parameters from JSON if provided
        let param_values: Vec<serde_json::Value> = if let Some(params_json) = params {
            serde_json::from_str(&params_json)
                .map_err(|e| Error::from_reason(format!("Failed to parse params: {}", e)))?
        } else {
            Vec::new()
        };

        let sqlite_params: Vec<rusqlite::types::Value> = param_values
            .into_iter()
            .map(json_to_sqlite_value)
            .collect();

        let param_refs: Vec<&dyn rusqlite::ToSql> = sqlite_params
            .iter()
            .map(|v| v as &dyn rusqlite::ToSql)
            .collect();

        // Execute query
        let column_count = stmt.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap().to_string())
            .collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut obj = serde_json::Map::new();
                for (i, name) in column_names.iter().enumerate() {
                    let value = sqlite_value_to_json(row, i)?;
                    obj.insert(name.clone(), value);
                }
                Ok(serde_json::Value::Object(obj))
            })
            .map_err(|e| Error::from_reason(format!("Query failed: {}", e)))?;

        let results: Vec<serde_json::Value> = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::from_reason(format!("Failed to collect rows: {}", e)))?;

        let json = serde_json::to_string(&results)
            .map_err(|e| Error::from_reason(format!("Failed to serialize results: {}", e)))?;

        Ok(json)
    }

    /// Execute a non-query SQL statement (INSERT, UPDATE, DELETE, etc.)
    #[napi]
    pub fn execute(&self, sql: String, params: Option<String>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();

        // Parse parameters from JSON if provided
        let param_values: Vec<serde_json::Value> = if let Some(params_json) = params {
            serde_json::from_str(&params_json)
                .map_err(|e| Error::from_reason(format!("Failed to parse params: {}", e)))?
        } else {
            Vec::new()
        };

        let sqlite_params: Vec<rusqlite::types::Value> = param_values
            .into_iter()
            .map(json_to_sqlite_value)
            .collect();

        let param_refs: Vec<&dyn rusqlite::ToSql> = sqlite_params
            .iter()
            .map(|v| v as &dyn rusqlite::ToSql)
            .collect();

        let rows_affected = conn
            .execute(&sql, param_refs.as_slice())
            .map_err(|e| Error::from_reason(format!("Execute failed: {}", e)))?;

        Ok(rows_affected as i64)
    }
}

/// Archive writer for creating .eng files
#[napi]
pub struct EngramWriter {
    inner: Option<ArchiveWriter>,
}

#[napi]
impl EngramWriter {
    /// Create a new archive file
    #[napi(constructor)]
    pub fn new(path: String) -> Result<Self> {
        let writer = ArchiveWriter::create(&path)
            .map_err(|e| Error::from_reason(format!("Failed to create archive: {}", e)))?;

        Ok(Self {
            inner: Some(writer),
        })
    }

    /// Add a file to the archive
    #[napi]
    pub fn add_file(&mut self, path: String, data: Buffer) -> Result<()> {
        let writer = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Writer already finalized"))?;

        writer
            .add_file(&path, &data)
            .map_err(|e| Error::from_reason(format!("Failed to add file: {}", e)))
    }

    /// Add a file with specific compression
    #[napi]
    pub fn add_file_with_compression(
        &mut self,
        path: String,
        data: Buffer,
        compression: CompressionMethod,
    ) -> Result<()> {
        let writer = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Writer already finalized"))?;

        writer
            .add_file_with_compression(&path, &data, compression.into())
            .map_err(|e| Error::from_reason(format!("Failed to add file: {}", e)))
    }

    /// Add a file from disk
    #[napi]
    pub fn add_file_from_disk(&mut self, archive_path: String, disk_path: String) -> Result<()> {
        let writer = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Writer already finalized"))?;

        writer
            .add_file_from_disk(&archive_path, std::path::Path::new(&disk_path))
            .map_err(|e| Error::from_reason(format!("Failed to add file from disk: {}", e)))
    }

    /// Add manifest.json from a JSON string
    #[napi]
    pub fn add_manifest(&mut self, manifest: String) -> Result<()> {
        let writer = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Writer already finalized"))?;

        let manifest_value: serde_json::Value = serde_json::from_str(&manifest)
            .map_err(|e| Error::from_reason(format!("Failed to parse manifest: {}", e)))?;

        writer
            .add_manifest(&manifest_value)
            .map_err(|e| Error::from_reason(format!("Failed to add manifest: {}", e)))
    }

    /// Finalize the archive (must be called before the writer is dropped)
    #[napi]
    pub fn finalize(&mut self) -> Result<()> {
        let writer = self
            .inner
            .take()
            .ok_or_else(|| Error::from_reason("Writer already finalized"))?;

        writer
            .finalize()
            .map_err(|e| Error::from_reason(format!("Failed to finalize archive: {}", e)))
    }
}

// Helper functions for converting between JSON and SQLite values

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
