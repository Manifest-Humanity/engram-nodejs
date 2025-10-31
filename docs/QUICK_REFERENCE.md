# Engram Node.js - Quick Reference

Quick reference for common operations.

## Installation

```bash
pnpm add engram-nodejs
# or
npm install engram-nodejs
```

## Creating Archives

### Basic Archive

```typescript
import { EngramWriter, createManifest } from 'engram-nodejs';

const writer = new EngramWriter('archive.eng');
writer.addManifest(createManifest({
  name: 'my-archive',
  version: '1.0.0'
}));
writer.addText('readme.txt', 'Hello!');
writer.finalize(); // Required!
```

### Add Files

```typescript
// Text file
writer.addText('docs/readme.md', 'Content here');

// JSON file
writer.addJson('config.json', { key: 'value' });

// Binary file
writer.addFile('data.bin', buffer);

// From disk
writer.addFileFromDisk('assets/logo.png', './logo.png');

// Database
writer.addDatabase('data.db', './database.db');

// With specific compression
import { CompressionMethod } from 'engram-nodejs';
writer.addFileWithCompression(
  'file.txt',
  buffer,
  CompressionMethod.Zstd
);
```

## Reading Archives

### Open and List

```typescript
import { EngramArchive } from 'engram-nodejs';

const archive = new EngramArchive('archive.eng');

// Get file count
console.log(archive.entryCount);

// List all files
const files = archive.listFiles();

// Check if file exists
if (archive.contains('config.json')) {
  // File exists
}

// Get metadata
const meta = archive.getMetadata('file.txt');
console.log(meta.uncompressedSize);
```

### Read Files

```typescript
// Sync read
const buffer = archive.readFileSync('file.bin');

// Async read
const buffer = await archive.readFile('file.bin');

// Read as text
const text = await archive.readText('readme.txt');

// Read as JSON
const config = await archive.readJson('config.json');

// Batch read
const [f1, f2, f3] = await archive.readFiles([
  'file1.txt',
  'file2.txt',
  'file3.txt'
]);

// Read manifest
const manifest = archive.readManifest();
```

### List by Prefix

```typescript
// List all files in a directory
const docsFiles = archive.listPrefix('docs/');

// List all JSON files
const allFiles = archive.listFiles();
const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
```

## Database Operations

### Open Database

```typescript
const db = archive.openDatabase('data.db');
```

### Query Data

```typescript
// Query all
const users = db.query('SELECT * FROM users');

// Parameterized query
const adults = db.query(
  'SELECT * FROM users WHERE age >= ?',
  [18]
);

// With type safety
interface User {
  id: number;
  name: string;
  email: string;
}
const users = db.query<User>('SELECT * FROM users');
```

### Query Single Results

```typescript
// Get one row
const user = db.queryOne(
  'SELECT * FROM users WHERE id = ?',
  [1]
);

// Get single value
const count = db.queryValue('SELECT COUNT(*) FROM users');
const avgAge = db.queryValue('SELECT AVG(age) FROM users');
```

### Execute Commands

```typescript
// INSERT, UPDATE, DELETE
const affected = db.execute(
  'UPDATE users SET active = 1 WHERE id = ?',
  [123]
);
console.log(`Updated ${affected} rows`);
```

### Helper Methods

```typescript
// Check if table exists
if (db.tableExists('users')) {
  const users = db.query('SELECT * FROM users');
}
```

## Error Handling

```typescript
try {
  const archive = new EngramArchive('data.eng');

  // Safe file read
  if (archive.contains('config.json')) {
    const config = await archive.readJson('config.json');
  }

  // Safe database access
  const db = archive.openDatabase('data.db');
  const results = db.query('SELECT * FROM users');

} catch (error) {
  if (error.message.includes('not found')) {
    console.error('File or database not found');
  } else if (error.message.includes('CRC')) {
    console.error('Data corruption detected');
  } else {
    console.error('Error:', error);
  }
}
```

## Complete Example

```typescript
import {
  EngramWriter,
  EngramArchive,
  createManifest,
  CompressionMethod
} from 'engram-nodejs';

// CREATE ARCHIVE
const writer = new EngramWriter('mydata.eng');

writer.addManifest(createManifest({
  name: 'my-data-package',
  version: '1.0.0',
  description: 'Data package with database'
}));

writer.addText('README.md', '# My Data Package');
writer.addJson('config.json', {
  mode: 'production',
  features: ['api', 'ui']
});
writer.addDatabase('data.db', './mydb.db');

writer.finalize();

// READ ARCHIVE
const archive = new EngramArchive('mydata.eng');

// Access manifest
const manifest = archive.readManifest();
console.log(`${manifest.name} v${manifest.version}`);

// Read files
const readme = await archive.readText('README.md');
const config = await archive.readJson('config.json');

// Query database
const db = archive.openDatabase('data.db');
const users = db.query('SELECT * FROM users WHERE active = 1');
const userCount = db.queryValue('SELECT COUNT(*) FROM users');

console.log(`Found ${userCount} users`);
users.forEach(user => {
  console.log(`- ${user.name}`);
});
```

## Common Patterns

### Configuration Bundle

```typescript
const writer = new EngramWriter('config.eng');

writer.addJson('dev.json', { debug: true });
writer.addJson('prod.json', { debug: false });

writer.finalize();
```

### Data Export

```typescript
const writer = new EngramWriter('export.eng');

writer.addManifest(createManifest({
  name: 'data-export',
  version: '1.0.0',
  created: new Date().toISOString()
}));

writer.addDatabase('main.db', './data.db');
writer.addJson('metadata.json', {
  recordCount: 1000,
  exported: Date.now()
});

writer.finalize();
```

### Read-Only Data Access

```typescript
const archive = new EngramArchive('data.eng');
const db = archive.openDatabase('readonly.db');

// Only SELECT queries work
const results = db.query('SELECT * FROM data');

// Attempting writes won't persist
// (Database is loaded in-memory)
```

## Tips

✅ **Always call `finalize()`** when done writing
✅ **Use parameterized queries** for SQL safety
✅ **Check file existence** before reading
✅ **Use batch operations** for multiple files
✅ **Let automatic compression** choose the method
✅ **Handle errors** appropriately
✅ **Cache metadata** if checking multiple times

## Compression Guide

| File Type | Auto Selection | Reason |
|-----------|----------------|--------|
| < 4KB | None | Overhead not worth it |
| .jpg, .png, .zip | None | Already compressed |
| .txt, .json, .xml | Zstd | Great text compression |
| .db, .sqlite | Zstd | Good DB compression |
| Other binary | LZ4 | Fast and safe default |

## Performance Tips

1. **Batch reads**: Use `readFiles()` for multiple files
2. **Async for large files**: Use `readFile()` not `readFileSync()`
3. **Database indexes**: Index frequently queried columns
4. **Cache archive handles**: Reuse `EngramArchive` instances
5. **Appropriate compression**: Use manual compression when needed

## Build Commands

All commands assume you are in the repository root.

```bash
# Build everything
pnpm run build

# Build debug version (faster)
pnpm run build:debug

# Build TypeScript only
pnpm run build:ts

# Run tests
pnpm test

# Run example
pnpm run example
```

## More Info

- [Full API Documentation](./API.md)
- [Getting Started Guide](./GETTING_STARTED.md)
- [Examples](../examples/)
- [Contributing](../CONTRIBUTING.md)

---

For detailed documentation, see the [README](../README.md).
