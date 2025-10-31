/**
 * Basic usage example for engram-nodejs
 *
 * This example demonstrates:
 * 1. Creating an archive with files and a SQLite database
 * 2. Reading files from the archive
 * 3. Querying the database without extraction
 */

import { EngramArchive, EngramWriter, createManifest } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const EXAMPLE_DIR = path.join(__dirname, 'temp');
const ARCHIVE_PATH = path.join(EXAMPLE_DIR, 'example.eng');
const DB_PATH = path.join(EXAMPLE_DIR, 'example.db');

async function main() {
  console.log('=== Engram System Basic Usage Example ===\n');

  // Ensure temp directory exists
  if (!fs.existsSync(EXAMPLE_DIR)) {
    fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
  }

  // Step 1: Create a SQLite database with sample data
  console.log('Step 1: Creating SQLite database...');
  createSampleDatabase();
  console.log('✓ Database created with sample data\n');

  // Step 2: Create an engram archive
  console.log('Step 2: Creating engram archive...');
  createEngramArchive();
  console.log('✓ Archive created successfully\n');

  // Step 3: Read files from the archive
  console.log('Step 3: Reading files from archive...');
  await readFilesFromArchive();
  console.log('');

  // Step 4: Access database from archive
  console.log('Step 4: Querying database from archive...');
  queryDatabaseFromArchive();
  console.log('');

  // Step 5: Show archive info
  console.log('Step 5: Archive information...');
  showArchiveInfo();
  console.log('');

  console.log('=== Example completed successfully! ===');
  console.log(`\nArchive location: ${ARCHIVE_PATH}`);
  console.log('You can now distribute this single .eng file with all data embedded.');
}

/**
 * Create a sample SQLite database
 */
function createSampleDatabase() {
  const db = new Database(DB_PATH);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      order_date TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Insert sample products
  const insertProduct = db.prepare(
    'INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)'
  );

  insertProduct.run('Laptop', 'Electronics', 999.99, 15);
  insertProduct.run('Mouse', 'Electronics', 29.99, 50);
  insertProduct.run('Keyboard', 'Electronics', 79.99, 30);
  insertProduct.run('Monitor', 'Electronics', 299.99, 20);
  insertProduct.run('Desk Chair', 'Furniture', 199.99, 10);

  // Insert sample orders
  const insertOrder = db.prepare(
    'INSERT INTO orders (product_id, quantity) VALUES (?, ?)'
  );

  insertOrder.run(1, 2);
  insertOrder.run(2, 5);
  insertOrder.run(3, 3);

  db.close();

  console.log(`  - Created database at: ${DB_PATH}`);
  console.log('  - Added 5 products and 3 orders');
}

/**
 * Create an engram archive with files and database
 */
function createEngramArchive() {
  const writer = new EngramWriter(ARCHIVE_PATH);

  // Add manifest
  writer.addManifest(createManifest({
    name: 'example-archive',
    version: '1.0.0',
    description: 'Example engram archive with product database',
    author: 'Engram System',
    license: 'MIT'
  }));

  // Add README
  writer.addText('README.md', `# Example Archive

This archive contains:
- A SQLite database with products and orders
- Configuration files
- Documentation

Created with Engram System.
`);

  // Add config file
  writer.addJson('config.json', {
    database: 'data/products.db',
    version: '1.0.0',
    settings: {
      readOnly: true,
      cache: true
    }
  });

  // Add database
  writer.addDatabase('data/products.db', DB_PATH);

  // Add some documentation files
  writer.addText('docs/schema.sql', `-- Database Schema

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER DEFAULT 0
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  order_date TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
`);

  writer.finalize();

  const stats = fs.statSync(ARCHIVE_PATH);
  console.log(`  - Archive size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`  - Compression: Automatic (LZ4/Zstd)`);
}

/**
 * Read files from the archive
 */
async function readFilesFromArchive() {
  const archive = new EngramArchive(ARCHIVE_PATH);

  // Read manifest
  const manifest = archive.readManifest();
  console.log(`  - Manifest: ${manifest.name} v${manifest.version}`);
  console.log(`  - Description: ${manifest.description}`);

  // Read README
  const readme = await archive.readText('README.md');
  console.log(`  - README preview: ${readme.split('\n')[0]}`);

  // Read config
  const config = await archive.readJson('config.json');
  console.log(`  - Config database path: ${config.database}`);
}

/**
 * Query database from archive without extraction
 */
function queryDatabaseFromArchive() {
  const archive = new EngramArchive(ARCHIVE_PATH);
  const db = archive.openDatabase('data/products.db');

  // Query products
  console.log('  Products in stock:');
  const products = db.query('SELECT name, category, price, stock FROM products ORDER BY price DESC');

  for (const product of products) {
    console.log(`    - ${product.name} (${product.category}): $${product.price} [Stock: ${product.stock}]`);
  }

  // Query orders with joins
  console.log('\n  Recent orders:');
  const orders = db.query(`
    SELECT o.id, p.name, o.quantity, o.order_date
    FROM orders o
    JOIN products p ON o.product_id = p.id
    ORDER BY o.order_date DESC
  `);

  for (const order of orders) {
    console.log(`    - Order #${order.id}: ${order.quantity}x ${order.name}`);
  }

  // Aggregate query
  const totalValue = db.queryValue(`
    SELECT SUM(p.price * o.quantity) as total
    FROM orders o
    JOIN products p ON o.product_id = p.id
  `);

  console.log(`\n  Total order value: $${totalValue?.toFixed(2)}`);
}

/**
 * Show archive information
 */
function showArchiveInfo() {
  const archive = new EngramArchive(ARCHIVE_PATH);

  console.log(`  - Total files: ${archive.entryCount}`);
  console.log('  - File list:');

  const files = archive.listFiles();
  for (const file of files) {
    const metadata = archive.getMetadata(file);
    if (metadata) {
      const ratio = ((1 - metadata.compressedSize / metadata.uncompressedSize) * 100).toFixed(1);
      console.log(`    - ${file}`);
      console.log(`      Size: ${metadata.uncompressedSize} bytes (${ratio}% compressed)`);
      console.log(`      Method: ${metadata.compressionMethod}`);
    }
  }
}

// Run the example
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
