// Simple verification script
const { EngramWriter, EngramArchive, createManifest } = require('./lib/index.js');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'engram-test-' + Date.now());
const TEST_ARCHIVE = path.join(TEST_DIR, 'test.eng');
const TEST_DB = path.join(TEST_DIR, 'test.db');

console.log('=== Engram System Verification ===\n');

// Create test directory
fs.mkdirSync(TEST_DIR, { recursive: true });

try {
  // Step 1: Create a SQLite database
  console.log('1. Creating SQLite database...');
  const db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run('Alice', 'alice@example.com');
  db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run('Bob', 'bob@example.com');
  db.close();
  console.log('   ✓ Database created with 2 users\n');

  // Step 2: Create engram archive
  console.log('2. Creating engram archive...');
  const writer = new EngramWriter(TEST_ARCHIVE);

  writer.addManifest(createManifest({
    name: 'test-archive',
    version: '1.0.0',
    description: 'Test archive'
  }));

  writer.addText('readme.txt', 'Hello from Engram!');
  writer.addJson('config.json', { setting: 'value', enabled: true });
  writer.addDatabase('data.db', TEST_DB);

  writer.finalize();
  console.log('   ✓ Archive created\n');

  // Step 3: Read from archive
  console.log('3. Reading from archive...');
  const archive = new EngramArchive(TEST_ARCHIVE);

  console.log(`   - Entry count: ${archive.entryCount}`);
  console.log(`   - Files: ${archive.listFiles().join(', ')}`);

  const readme = archive.readFileSync('readme.txt').toString('utf-8');
  console.log(`   - readme.txt: "${readme}"`);

  const manifest = archive.readManifest();
  console.log(`   - Manifest: ${manifest.name} v${manifest.version}`);
  console.log('   ✓ Files read successfully\n');

  // Step 4: Query database
  console.log('4. Querying database from archive...');
  const archiveDb = archive.openDatabase('data.db');

  const users = archiveDb.query('SELECT * FROM users ORDER BY id');
  console.log(`   - Found ${users.length} users:`);
  users.forEach(user => {
    console.log(`     * ${user.name} (${user.email})`);
  });

  const count = archiveDb.queryValue('SELECT COUNT(*) FROM users');
  console.log(`   - Total users: ${count}`);
  console.log('   ✓ Database queries work!\n');

  console.log('=== ALL TESTS PASSED! ===');
  console.log(`\nTest archive: ${TEST_ARCHIVE}`);
  console.log(`Archive size: ${(fs.statSync(TEST_ARCHIVE).size / 1024).toFixed(2)} KB`);

} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  // Cleanup
  // fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
