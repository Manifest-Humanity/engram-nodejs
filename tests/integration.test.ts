/**
 * Integration tests for engram-nodejs
 */

import { EngramArchive, EngramWriter, createManifest, CompressionMethod } from '../src/index';
import { createTestDatabase, cleanupTestFiles } from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'engram-tests');
const TEST_ARCHIVE = path.join(TEST_DIR, 'test.eng');
const TEST_DB = path.join(TEST_DIR, 'test.db');

describe('Engram System Integration Tests', () => {
  beforeAll(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    cleanupTestFiles(TEST_DIR);
  });

  describe('Archive Creation and Reading', () => {
    it('should create and read a basic archive', () => {
      const archivePath = path.join(TEST_DIR, 'basic.eng');

      // Create archive
      const writer = new EngramWriter(archivePath);
      writer.addText('hello.txt', 'Hello, World!');
      writer.addJson('data.json', { key: 'value', number: 42 });
      writer.finalize();

      // Read archive
      const reader = new EngramArchive(archivePath);
      expect(reader.entryCount).toBe(2);
      expect(reader.contains('hello.txt')).toBe(true);
      expect(reader.contains('data.json')).toBe(true);

      const text = reader.readFileSync('hello.txt').toString('utf-8');
      expect(text).toBe('Hello, World!');

      const json = JSON.parse(reader.readFileSync('data.json').toString('utf-8'));
      expect(json.key).toBe('value');
      expect(json.number).toBe(42);
    });

    it('should handle manifest.json', () => {
      const archivePath = path.join(TEST_DIR, 'manifest.eng');

      const manifest = createManifest({
        name: 'test-archive',
        version: '1.0.0',
        description: 'Test archive with manifest'
      });

      const writer = new EngramWriter(archivePath);
      writer.addManifest(manifest);
      writer.addText('readme.txt', 'This is a test');
      writer.finalize();

      const reader = new EngramArchive(archivePath);
      const readManifest = reader.readManifest();

      expect(readManifest).not.toBeNull();
      expect(readManifest.name).toBe('test-archive');
      expect(readManifest.version).toBe('1.0.0');
    });

    it('should handle different compression methods', () => {
      const archivePath = path.join(TEST_DIR, 'compression.eng');
      const testData = Buffer.from('This is test data that should compress well. '.repeat(100));

      const writer = new EngramWriter(archivePath);
      writer.addFileWithCompression('none.bin', testData, CompressionMethod.None);
      writer.addFileWithCompression('lz4.bin', testData, CompressionMethod.Lz4);
      writer.addFileWithCompression('zstd.bin', testData, CompressionMethod.Zstd);
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      // All should decompress to same data
      const none = reader.readFileSync('none.bin');
      const lz4 = reader.readFileSync('lz4.bin');
      const zstd = reader.readFileSync('zstd.bin');

      expect(Buffer.compare(none, testData)).toBe(0);
      expect(Buffer.compare(lz4, testData)).toBe(0);
      expect(Buffer.compare(zstd, testData)).toBe(0);

      // Check metadata
      const noneMetadata = reader.getMetadata('none.bin');
      const lz4Metadata = reader.getMetadata('lz4.bin');
      const zstdMetadata = reader.getMetadata('zstd.bin');

      expect(noneMetadata?.compressedSize).toBe(noneMetadata?.uncompressedSize);
      expect(lz4Metadata?.compressedSize).toBeLessThan(lz4Metadata?.uncompressedSize || 0);
      expect(zstdMetadata?.compressedSize).toBeLessThan(zstdMetadata?.uncompressedSize || 0);
    });

    it('should support async file reading', async () => {
      const archivePath = path.join(TEST_DIR, 'async.eng');

      const writer = new EngramWriter(archivePath);
      writer.addText('file1.txt', 'Content 1');
      writer.addText('file2.txt', 'Content 2');
      writer.addText('file3.txt', 'Content 3');
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      // Single file
      const content1 = await reader.readText('file1.txt');
      expect(content1).toBe('Content 1');

      // Batch read
      const buffers = await reader.readFiles(['file1.txt', 'file2.txt', 'file3.txt']);
      expect(buffers).toHaveLength(3);
      expect(buffers[0].toString('utf-8')).toBe('Content 1');
      expect(buffers[1].toString('utf-8')).toBe('Content 2');
      expect(buffers[2].toString('utf-8')).toBe('Content 3');
    });

    it('should list files with prefix', () => {
      const archivePath = path.join(TEST_DIR, 'prefix.eng');

      const writer = new EngramWriter(archivePath);
      writer.addText('docs/readme.md', 'Readme');
      writer.addText('docs/guide.md', 'Guide');
      writer.addText('src/main.ts', 'Main code');
      writer.addText('src/utils.ts', 'Utils');
      writer.addText('package.json', '{}');
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      const docs = reader.listPrefix('docs/');
      expect(docs).toHaveLength(2);
      expect(docs).toContain('docs/readme.md');
      expect(docs).toContain('docs/guide.md');

      const src = reader.listPrefix('src/');
      expect(src).toHaveLength(2);
    });
  });

  describe('SQLite Database Access', () => {
    beforeAll(() => {
      // Create test database
      createTestDatabase(TEST_DB);
    });

    it('should access SQLite database from archive', () => {
      const archivePath = path.join(TEST_DIR, 'database.eng');

      // Create archive with database
      const writer = new EngramWriter(archivePath);
      writer.addDatabase('data.db', TEST_DB);
      writer.addManifest(createManifest({
        name: 'database-archive',
        version: '1.0.0'
      }));
      writer.finalize();

      // Open database from archive
      const reader = new EngramArchive(archivePath);
      const db = reader.openDatabase('data.db');

      // Query database
      const users = db.query('SELECT * FROM users ORDER BY id');
      expect(users).toHaveLength(3);
      expect(users[0].name).toBe('Alice');
      expect(users[1].name).toBe('Bob');
      expect(users[2].name).toBe('Charlie');
    });

    it('should support parameterized queries', () => {
      const archivePath = path.join(TEST_DIR, 'params.eng');

      const writer = new EngramWriter(archivePath);
      writer.addDatabase('data.db', TEST_DB);
      writer.finalize();

      const reader = new EngramArchive(archivePath);
      const db = reader.openDatabase('data.db');

      const user = db.queryOne('SELECT * FROM users WHERE name = ?', ['Bob']);
      expect(user).not.toBeNull();
      expect(user.name).toBe('Bob');
      expect(user.email).toBe('bob@example.com');
    });

    it('should support helper methods', () => {
      const archivePath = path.join(TEST_DIR, 'helpers.eng');

      const writer = new EngramWriter(archivePath);
      writer.addDatabase('data.db', TEST_DB);
      writer.finalize();

      const reader = new EngramArchive(archivePath);
      const db = reader.openDatabase('data.db');

      // queryOne
      const firstUser = db.queryOne('SELECT * FROM users ORDER BY id LIMIT 1');
      expect(firstUser).not.toBeNull();
      expect(firstUser.name).toBe('Alice');

      // queryValue
      const count = db.queryValue('SELECT COUNT(*) as count FROM users');
      expect(count).toBe(3);

      // tableExists
      expect(db.tableExists('users')).toBe(true);
      expect(db.tableExists('nonexistent')).toBe(false);
    });

    it('should access both files and database from same archive', async () => {
      const archivePath = path.join(TEST_DIR, 'mixed.eng');

      const writer = new EngramWriter(archivePath);
      writer.addManifest(createManifest({
        name: 'mixed-content',
        version: '1.0.0',
        description: 'Archive with files and database'
      }));
      writer.addText('readme.txt', 'This archive contains a database');
      writer.addJson('config.json', { dbPath: 'data.db' });
      writer.addDatabase('data.db', TEST_DB);
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      // Access manifest
      const manifest = reader.readManifest();
      expect(manifest.name).toBe('mixed-content');

      // Access files
      const readme = await reader.readText('readme.txt');
      expect(readme).toContain('database');

      const config = await reader.readJson('config.json');
      expect(config.dbPath).toBe('data.db');

      // Access database
      const db = reader.openDatabase('data.db');
      const userCount = db.queryValue('SELECT COUNT(*) FROM users');
      expect(userCount).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent file', () => {
      const archivePath = path.join(TEST_DIR, 'errors.eng');

      const writer = new EngramWriter(archivePath);
      writer.addText('exists.txt', 'I exist');
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      expect(() => {
        reader.readFileSync('nonexistent.txt');
      }).toThrow();
    });

    it('should throw error for non-existent database', () => {
      const archivePath = path.join(TEST_DIR, 'no-db.eng');

      const writer = new EngramWriter(archivePath);
      writer.addText('file.txt', 'Just a file');
      writer.finalize();

      const reader = new EngramArchive(archivePath);

      expect(() => {
        reader.openDatabase('nonexistent.db');
      }).toThrow();
    });

    it('should not allow operations on finalized writer', () => {
      const archivePath = path.join(TEST_DIR, 'finalized.eng');

      const writer = new EngramWriter(archivePath);
      writer.addText('test.txt', 'test');
      writer.finalize();

      expect(() => {
        writer.addText('another.txt', 'another');
      }).toThrow('Writer already finalized');
    });
  });
});
