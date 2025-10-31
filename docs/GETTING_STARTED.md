# Getting Started with Engram Node.js

This guide will walk you through using the Engram Node.js bindings to create and access `.eng` archives with embedded SQLite databases.

## Installation

### From package manager (when published)

```bash
pnpm add engram-nodejs
# or
npm install engram-nodejs
```

### Environment variables

To build from source you need a GitHub Personal Access Token (classic, with `repo` read scope) that can access the private `Manifest-Humanity/engram-core` repository. Save it in `.env`:

```bash
cp .env.example .env
echo "ENGRAM_CORE_TOKEN=ghp_your_token_here" >> .env
```

### From source

```bash
git clone https://github.com/yourusername/engram-nodejs.git
cd engram-nodejs
pnpm run build:local   # installs deps, loads .env, and builds the project
```

## Your First Archive

Let's create a simple archive with some files and a database.

### Step 1: Create a Database

First, create a SQLite database with some sample data:

```typescript
import Database from 'better-sqlite3';

// Create database
const db = new Database('mydata.db');

// Create schema
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);

// Insert data
const insert = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
insert.run('Alice', 'alice@example.com');
insert.run('Bob', 'bob@example.com');

db.close();
```

### Step 2: Create an Archive

Now let's package this database along with some files into an archive:

```typescript
import { EngramWriter, createManifest } from 'engram-nodejs';

// Create a new archive
const writer = new EngramWriter('myarchive.eng');

// Add manifest (metadata about the archive)
writer.addManifest(createManifest({
  name: 'my-first-archive',
  version: '1.0.0',
  description: 'My first engram archive',
  author: 'Your Name'
}));

// Add text files
writer.addText('README.md', `# My Archive

This archive contains a user database and configuration.
`);

// Add JSON configuration
writer.addJson('config.json', {
  database: 'data.db',
  version: '1.0.0',
  features: ['users', 'api']
});

// Add the SQLite database
writer.addDatabase('data.db', 'mydata.db');

// Finalize (very important!)
writer.finalize();

console.log('✓ Archive created: myarchive.eng');
```

### Step 3: Read from the Archive

Now let's read files and query the database:

```typescript
import { EngramArchive } from 'engram-nodejs';

// Open the archive
const archive = new EngramArchive('myarchive.eng');

// Read the manifest
const manifest = archive.readManifest();
console.log(`Archive: ${manifest.name} v${manifest.version}`);
console.log(`Description: ${manifest.description}`);

// Read text file
const readme = await archive.readText('README.md');
console.log('\nREADME:\n', readme);

// Read JSON
const config = await archive.readJson('config.json');
console.log('Config:', config);

// Query the database (no extraction needed!)
const db = archive.openDatabase('data.db');
const users = db.query('SELECT * FROM users');

console.log('\nUsers in database:');
users.forEach(user => {
  console.log(`- ${user.name} (${user.email})`);
});
```

## Common Use Cases

### Use Case 1: Application Data Package

Package your application with configuration and data:

```typescript
const writer = new EngramWriter('app-data.eng');

writer.addManifest(createManifest({
  name: 'my-app-data',
  version: '2.1.0'
}));

// Add configuration
writer.addJson('config/app.json', {
  apiUrl: 'https://api.example.com',
  theme: 'dark'
});

writer.addJson('config/features.json', {
  featureA: true,
  featureB: false
});

// Add database with user data
writer.addDatabase('db/users.db', './users.db');

// Add static assets
writer.addFileFromDisk('assets/logo.png', './logo.png');

writer.finalize();
```

Reading it:

```typescript
const archive = new EngramArchive('app-data.eng');

// Load config
const appConfig = await archive.readJson('config/app.json');

// Access database
const db = archive.openDatabase('db/users.db');
const activeUsers = db.query('SELECT * FROM users WHERE active = 1');

// Get assets
const logo = archive.readFileSync('assets/logo.png');
```

### Use Case 2: Data Distribution

Distribute a dataset with queryable database:

```typescript
// Create a dataset archive
const writer = new EngramWriter('dataset.eng');

writer.addManifest(createManifest({
  name: 'world-cities-dataset',
  version: '2024.1.0',
  description: 'World cities with population data',
  author: 'Data Team',
  license: 'CC-BY-4.0'
}));

// Add documentation
writer.addText('README.md', `# World Cities Dataset

This dataset contains information about cities worldwide...
`);

// Add schema documentation
writer.addText('schema.sql', `
CREATE TABLE cities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  population INTEGER,
  latitude REAL,
  longitude REAL
);
`);

// Add the database
writer.addDatabase('cities.db', './cities.db');

// Add supplementary data
writer.addJson('metadata.json', {
  recordCount: 50000,
  lastUpdated: new Date().toISOString(),
  source: 'OpenStreetMap'
});

writer.finalize();
```

Using the dataset:

```typescript
const dataset = new EngramArchive('dataset.eng');

// Read metadata
const metadata = await dataset.readJson('metadata.json');
console.log(`Dataset has ${metadata.recordCount} records`);

// Query cities
const db = dataset.openDatabase('cities.db');

// Find large cities
const largeCities = db.query(`
  SELECT name, country, population
  FROM cities
  WHERE population > 1000000
  ORDER BY population DESC
  LIMIT 10
`);

// Geographic search
const nearbyCities = db.query(`
  SELECT name, country
  FROM cities
  WHERE latitude BETWEEN ? AND ?
    AND longitude BETWEEN ? AND ?
`, [40.0, 41.0, -74.0, -73.0]);
```

### Use Case 3: Configuration Bundle

Bundle multiple configuration files:

```typescript
const writer = new EngramWriter('config-bundle.eng');

writer.addJson('environments/development.json', {
  apiUrl: 'http://localhost:3000',
  debug: true
});

writer.addJson('environments/production.json', {
  apiUrl: 'https://api.production.com',
  debug: false
});

writer.addJson('features.json', {
  newUI: true,
  analytics: true,
  betaFeatures: false
});

writer.finalize();
```

## Advanced Topics

### Compression Control

Control compression for specific files:

```typescript
import { CompressionMethod } from 'engram-nodejs';

const writer = new EngramWriter('archive.eng');

// No compression (already compressed format)
writer.addFileWithCompression(
  'image.jpg',
  imageBuffer,
  CompressionMethod.None
);

// Fast compression (LZ4) for frequently accessed data
writer.addFileWithCompression(
  'cache.bin',
  cacheData,
  CompressionMethod.Lz4
);

// Best compression (Zstd) for text
writer.addFileWithCompression(
  'large-log.txt',
  logData,
  CompressionMethod.Zstd
);

writer.finalize();
```

### Batch Operations

Read multiple files efficiently:

```typescript
const archive = new EngramArchive('archive.eng');

// Batch read multiple files
const [file1, file2, file3] = await archive.readFiles([
  'file1.txt',
  'file2.txt',
  'file3.txt'
]);

// Process in parallel
const results = await Promise.all([
  archive.readJson('config1.json'),
  archive.readJson('config2.json'),
  archive.readText('readme.md')
]);
```

### Database Best Practices

```typescript
const archive = new EngramArchive('data.eng');
const db = archive.openDatabase('app.db');

// Use parameterized queries (prevents SQL injection)
const user = db.queryOne(
  'SELECT * FROM users WHERE email = ?',
  [userEmail]
);

// Use helper methods
if (db.tableExists('users')) {
  const count = db.queryValue('SELECT COUNT(*) FROM users');
  console.log(`${count} users in database`);
}

// Complex queries with joins
const ordersWithProducts = db.query(`
  SELECT o.id, o.quantity, p.name, p.price
  FROM orders o
  JOIN products p ON o.product_id = p.id
  WHERE o.user_id = ?
`, [userId]);
```

### Error Handling

```typescript
try {
  const archive = new EngramArchive('data.eng');

  if (archive.contains('config.json')) {
    const config = await archive.readJson('config.json');
    console.log('Config loaded:', config);
  } else {
    console.warn('Config file not found, using defaults');
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
    console.error('Unexpected error:', error);
  }
}
```

## Performance Tips

1. **Use batch operations**: Read multiple files with `readFiles()`
2. **Cache metadata**: Get metadata once and reuse
3. **Choose right compression**: LZ4 for speed, Zstd for size
4. **Sync for small files**: `readFileSync()` has less overhead
5. **Index your databases**: Create indexes for common queries

## Next Steps

- Read the [API Documentation](./API.md) for complete reference
- Check out more [examples](../examples/)
- Learn about the [archive format specification](../SPEC.md)
- [Contribute](../CONTRIBUTING.md) to the project

## Getting Help

- Check the [FAQ](./FAQ.md)
- Search [existing issues](https://github.com/yourusername/engram-nodejs/issues)
- Ask in [discussions](https://github.com/yourusername/engram-nodejs/discussions)
- Join our [Discord community](https://discord.gg/your-invite)

---

Happy archiving! 📦
