# API Documentation

Complete API reference for Engram Node.js.

## Table of Contents

- [EngramWriter](#engramwriter)
- [EngramArchive](#engramarchive)
- [EngramDatabase](#engramdatabase)
- [Types and Enums](#types-and-enums)
- [Helper Functions](#helper-functions)

---

## EngramWriter

The `EngramWriter` class is used to create new `.eng` archive files.

### Constructor

```typescript
constructor(path: string)
```

Creates a new archive at the specified path.

**Parameters:**
- `path`: Path where the archive will be created

**Example:**
```typescript
const writer = new EngramWriter('output.eng');
```

### Methods

#### addFile()

```typescript
addFile(path: string, data: Buffer): void
```

Add a file to the archive with automatic compression selection.

**Parameters:**
- `path`: Path within the archive (e.g., "docs/readme.txt")
- `data`: File contents as a Buffer

**Example:**
```typescript
writer.addFile('data.bin', Buffer.from([1, 2, 3, 4]));
```

---

#### addText()

```typescript
addText(path: string, text: string): void
```

Add a text file to the archive.

**Parameters:**
- `path`: Path within the archive
- `text`: Text content (will be encoded as UTF-8)

**Example:**
```typescript
writer.addText('readme.txt', 'Hello, World!');
```

---

#### addJson()

```typescript
addJson(path: string, data: any): void
```

Add a JSON file to the archive.

**Parameters:**
- `path`: Path within the archive
- `data`: Any JSON-serializable object

**Example:**
```typescript
writer.addJson('config.json', {
  version: '1.0.0',
  settings: { theme: 'dark' }
});
```

---

#### addFileFromDisk()

```typescript
addFileFromDisk(archivePath: string, diskPath: string): void
```

Add a file from the filesystem to the archive.

**Parameters:**
- `archivePath`: Path within the archive
- `diskPath`: Path to file on disk

**Example:**
```typescript
writer.addFileFromDisk('assets/logo.png', '/path/to/logo.png');
```

---

#### addFileWithCompression()

```typescript
addFileWithCompression(
  path: string,
  data: Buffer,
  compression: CompressionMethod
): void
```

Add a file with a specific compression method.

**Parameters:**
- `path`: Path within the archive
- `data`: File contents as a Buffer
- `compression`: Compression method to use

**Example:**
```typescript
writer.addFileWithCompression(
  'large.txt',
  buffer,
  CompressionMethod.Zstd
);
```

---

#### addDatabase()

```typescript
addDatabase(archivePath: string, diskPath: string): void
```

Add a SQLite database file to the archive.

**Parameters:**
- `archivePath`: Path within the archive
- `diskPath`: Path to SQLite database on disk

**Example:**
```typescript
writer.addDatabase('data/app.db', './database.db');
```

---

#### addManifest()

```typescript
addManifest(manifest: any): void
```

Add a manifest.json file to the archive.

**Parameters:**
- `manifest`: Object to be serialized as manifest.json

**Example:**
```typescript
writer.addManifest({
  name: 'my-archive',
  version: '1.0.0',
  description: 'My data archive'
});
```

---

#### finalize()

```typescript
finalize(): void
```

Finalize the archive. **This method must be called** before the writer is disposed, or the archive will be incomplete.

**Example:**
```typescript
writer.finalize();
```

**Important:** After calling `finalize()`, no more files can be added to the archive.

---

## EngramArchive

The `EngramArchive` class is used to read files and access databases from `.eng` archives.

### Constructor

```typescript
constructor(path: string)
```

Open an existing archive for reading.

**Parameters:**
- `path`: Path to the archive file

**Example:**
```typescript
const archive = new EngramArchive('data.eng');
```

### Properties

#### entryCount

```typescript
readonly entryCount: number
```

Get the number of files in the archive.

**Example:**
```typescript
console.log(`Archive contains ${archive.entryCount} files`);
```

### Methods

#### listFiles()

```typescript
listFiles(): string[]
```

Get a list of all file paths in the archive.

**Returns:** Array of file paths

**Example:**
```typescript
const files = archive.listFiles();
files.forEach(file => console.log(file));
```

---

#### contains()

```typescript
contains(path: string): boolean
```

Check if a file exists in the archive.

**Parameters:**
- `path`: File path to check

**Returns:** `true` if the file exists, `false` otherwise

**Example:**
```typescript
if (archive.contains('config.json')) {
  // File exists
}
```

---

#### getMetadata()

```typescript
getMetadata(path: string): EntryMetadata | null
```

Get metadata for a file in the archive.

**Parameters:**
- `path`: File path

**Returns:** Metadata object or `null` if file doesn't exist

**Example:**
```typescript
const meta = archive.getMetadata('large.db');
if (meta) {
  console.log(`Size: ${meta.uncompressedSize} bytes`);
  console.log(`Compressed: ${meta.compressedSize} bytes`);
  console.log(`Compression: ${meta.compressionMethod}`);
}
```

---

#### readFileSync()

```typescript
readFileSync(path: string): Buffer
```

Read a file from the archive synchronously.

**Parameters:**
- `path`: File path to read

**Returns:** Buffer containing file contents

**Throws:** Error if file doesn't exist or CRC check fails

**Example:**
```typescript
const data = archive.readFileSync('data.bin');
```

---

#### readFile()

```typescript
async readFile(path: string): Promise<Buffer>
```

Read a file from the archive asynchronously.

**Parameters:**
- `path`: File path to read

**Returns:** Promise resolving to Buffer with file contents

**Example:**
```typescript
const data = await archive.readFile('large-file.bin');
```

---

#### readFiles()

```typescript
async readFiles(paths: string[]): Promise<Buffer[]>
```

Read multiple files from the archive in a single operation (batch read).

**Parameters:**
- `paths`: Array of file paths to read

**Returns:** Promise resolving to array of Buffers

**Example:**
```typescript
const [file1, file2, file3] = await archive.readFiles([
  'file1.txt',
  'file2.txt',
  'file3.txt'
]);
```

---

#### readText()

```typescript
async readText(path: string): Promise<string>
```

Read a file as UTF-8 text.

**Parameters:**
- `path`: File path to read

**Returns:** Promise resolving to string

**Example:**
```typescript
const readme = await archive.readText('README.md');
console.log(readme);
```

---

#### readJson()

```typescript
async readJson<T = any>(path: string): Promise<T>
```

Read and parse a JSON file.

**Parameters:**
- `path`: File path to read

**Returns:** Promise resolving to parsed JSON object

**Example:**
```typescript
interface Config {
  version: string;
  settings: Record<string, any>;
}

const config = await archive.readJson<Config>('config.json');
console.log(config.version);
```

---

#### readManifest()

```typescript
readManifest(): any | null
```

Read and parse manifest.json if it exists.

**Returns:** Parsed manifest object or `null` if no manifest exists

**Example:**
```typescript
const manifest = archive.readManifest();
if (manifest) {
  console.log(`${manifest.name} v${manifest.version}`);
}
```

---

#### listPrefix()

```typescript
listPrefix(prefix: string): string[]
```

List all files with a given path prefix.

**Parameters:**
- `prefix`: Path prefix to match

**Returns:** Array of matching file paths

**Example:**
```typescript
// List all files in the docs/ directory
const docFiles = archive.listPrefix('docs/');

// List all markdown files
const mdFiles = archive.listFiles().filter(f => f.endsWith('.md'));
```

---

#### openDatabase()

```typescript
openDatabase(dbPath: string): EngramDatabase
```

Open a SQLite database from the archive.

**Parameters:**
- `dbPath`: Path to database file within the archive

**Returns:** EngramDatabase instance

**Throws:** Error if database doesn't exist in archive

**Example:**
```typescript
const db = archive.openDatabase('data/app.db');
const users = db.query('SELECT * FROM users');
```

---

## EngramDatabase

The `EngramDatabase` class provides access to SQLite databases embedded in archives.

### Methods

#### query()

```typescript
query<T = any>(sql: string, params?: any[]): T[]
```

Execute a SELECT query and return all results.

**Parameters:**
- `sql`: SQL query string
- `params`: Optional array of parameter values for prepared statement

**Returns:** Array of result objects

**Example:**
```typescript
// Simple query
const users = db.query('SELECT * FROM users');

// Parameterized query
const adults = db.query<User>(
  'SELECT * FROM users WHERE age >= ?',
  [18]
);
```

---

#### queryOne()

```typescript
queryOne<T = any>(sql: string, params?: any[]): T | null
```

Execute a query and return the first result.

**Parameters:**
- `sql`: SQL query string
- `params`: Optional array of parameter values

**Returns:** First result object or `null` if no results

**Example:**
```typescript
const user = db.queryOne(
  'SELECT * FROM users WHERE id = ?',
  [123]
);

if (user) {
  console.log(user.name);
}
```

---

#### queryValue()

```typescript
queryValue<T = any>(sql: string, params?: any[]): T | null
```

Execute a query and return a single value from the first result.

**Parameters:**
- `sql`: SQL query string
- `params`: Optional array of parameter values

**Returns:** Single value or `null` if no results

**Example:**
```typescript
const count = db.queryValue<number>(
  'SELECT COUNT(*) FROM users'
);

const maxAge = db.queryValue<number>(
  'SELECT MAX(age) FROM users WHERE city = ?',
  ['New York']
);
```

---

#### execute()

```typescript
execute(sql: string, params?: any[]): number
```

Execute a non-query SQL statement (INSERT, UPDATE, DELETE, etc.).

**Parameters:**
- `sql`: SQL statement
- `params`: Optional array of parameter values

**Returns:** Number of rows affected

**Example:**
```typescript
const affected = db.execute(
  'UPDATE users SET active = 1 WHERE last_login > ?',
  [Date.now() - 86400000]
);

console.log(`Updated ${affected} users`);
```

---

#### tableExists()

```typescript
tableExists(tableName: string): boolean
```

Check if a table exists in the database.

**Parameters:**
- `tableName`: Name of the table to check

**Returns:** `true` if table exists, `false` otherwise

**Example:**
```typescript
if (db.tableExists('users')) {
  const users = db.query('SELECT * FROM users');
}
```

---

## Types and Enums

### CompressionMethod

```typescript
enum CompressionMethod {
  None = 0,   // No compression
  Lz4 = 1,    // LZ4 compression (fast)
  Zstd = 2,   // Zstandard compression (balanced)
  Deflate = 3 // Deflate compression (not yet implemented)
}
```

### EntryMetadata

```typescript
interface EntryMetadata {
  path: string;              // File path within archive
  uncompressedSize: number;  // Original file size in bytes
  compressedSize: number;    // Compressed size in bytes
  compressionMethod: string; // Compression method used
  modifiedTime: number;      // Unix timestamp
}
```

### EngramManifest

```typescript
interface EngramManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  created?: string;
  [key: string]: any;  // Additional custom fields
}
```

---

## Helper Functions

### createManifest()

```typescript
function createManifest(data: EngramManifest): EngramManifest
```

Create a manifest object with automatic timestamp.

**Parameters:**
- `data`: Manifest data

**Returns:** Manifest object with `created` timestamp

**Example:**
```typescript
const manifest = createManifest({
  name: 'my-archive',
  version: '1.0.0',
  description: 'My data archive',
  author: 'John Doe',
  license: 'MIT'
});

writer.addManifest(manifest);
```

---

## Error Handling

All methods may throw errors in the following cases:

- **File not found**: When trying to read a non-existent file
- **CRC mismatch**: When file data is corrupted
- **Invalid archive**: When opening a corrupted or invalid archive
- **SQLite errors**: When database queries fail
- **I/O errors**: When filesystem operations fail

**Example:**
```typescript
try {
  const data = archive.readFileSync('config.json');
} catch (error) {
  if (error.message.includes('not found')) {
    console.error('Config file missing');
  } else if (error.message.includes('CRC')) {
    console.error('File corrupted');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## Best Practices

1. **Always finalize writers**: Call `writer.finalize()` when done
2. **Use batch operations**: Use `readFiles()` for multiple files
3. **Handle errors**: Wrap operations in try-catch blocks
4. **Check existence**: Use `contains()` before reading files
5. **Close connections**: Archive readers are automatically closed when garbage collected
6. **Use parameterized queries**: Always use parameter placeholders in SQL to prevent injection
7. **Choose compression wisely**: Use appropriate compression for file types

---

## Performance Tips

1. **Batch reads**: Use `readFiles()` instead of multiple `readFile()` calls
2. **Cache metadata**: Call `getMetadata()` once and cache the result
3. **Use sync for small files**: `readFileSync()` has less overhead for small files
4. **Database queries**: Use indexes and appropriate WHERE clauses
5. **Compression**: Let automatic selection choose the best method
6. **Memory**: Be aware that databases are loaded into memory

---

For more examples, see the [examples directory](../examples/) and the archive specification in `engram-core/docs/SPEC.md`.
