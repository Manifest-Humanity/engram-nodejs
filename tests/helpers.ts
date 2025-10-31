/**
 * Test helper functions
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Create a test SQLite database with sample data
 */
export function createTestDatabase(dbPath: string): void {
  // Remove if exists
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // Create schema
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Insert sample data
  const insertUser = db.prepare('INSERT INTO users (name, email, age) VALUES (?, ?, ?)');
  insertUser.run('Alice', 'alice@example.com', 30);
  insertUser.run('Bob', 'bob@example.com', 25);
  insertUser.run('Charlie', 'charlie@example.com', 35);

  const insertPost = db.prepare('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)');
  insertPost.run(1, 'First Post', 'This is Alice\'s first post');
  insertPost.run(1, 'Second Post', 'Another post from Alice');
  insertPost.run(2, 'Bob\'s Post', 'Hello from Bob');

  db.close();
}

/**
 * Clean up test files and directories
 */
export function cleanupTestFiles(dir: string): void {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        cleanupTestFiles(filePath);
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }
}
