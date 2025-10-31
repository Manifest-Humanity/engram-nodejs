/**
 * Engram System - Virtual filesystem and SQLite access for .eng archives
 *
 * This module provides high-level TypeScript APIs for working with .eng archive files.
 */

import type {
  EngramArchive as NativeArchive,
  EngramWriter as NativeWriter,
  EngramDatabase as NativeDatabase,
  CompressionMethod as NativeCompressionMethod,
  EntryMetadata as NativeEntryMetadata
} from './native';

// Load the actual native module at runtime
const nativeModule = require('../dist/index.js');
const NativeArchiveImpl = nativeModule.EngramArchive as typeof NativeArchive;
const NativeWriterImpl = nativeModule.EngramWriter as typeof NativeWriter;
const NativeDatabaseImpl = nativeModule.EngramDatabase as typeof NativeDatabase;

// Re-export native enums and interfaces
export const CompressionMethod = nativeModule.CompressionMethod;
export type { EntryMetadata } from './native';

// Import for internal use
import type { CompressionMethod as CompressionMethodType, EntryMetadata as EntryMetadataType } from './native';

/**
 * Archive reader for accessing files and databases from .eng archives
 */
export class EngramArchive {
  private native: NativeArchive;

  constructor(path: string) {
    this.native = new NativeArchiveImpl(path);
  }

  /**
   * Get the number of entries in the archive
   */
  get entryCount(): number {
    return this.native.entryCount();
  }

  /**
   * List all file paths in the archive
   */
  listFiles(): string[] {
    return this.native.listFiles();
  }

  /**
   * Check if a file exists in the archive
   */
  contains(path: string): boolean {
    return this.native.contains(path);
  }

  /**
   * Get metadata for a file
   */
  getMetadata(path: string): EntryMetadataType | null {
    return this.native.getMetadata(path);
  }

  /**
   * Read a file from the archive (synchronous)
   */
  readFileSync(path: string): Buffer {
    return this.native.readFileSync(path);
  }

  /**
   * Read a file from the archive (asynchronous)
   */
  async readFile(path: string): Promise<Buffer> {
    return await this.native.readFile(path);
  }

  /**
   * Read multiple files from the archive (batch operation)
   */
  async readFiles(paths: string[]): Promise<Buffer[]> {
    return await this.native.readFiles(paths);
  }

  /**
   * Read and parse manifest.json
   */
  readManifest(): any | null {
    const manifestJson = this.native.readManifest();
    if (!manifestJson) return null;
    return JSON.parse(manifestJson);
  }

  /**
   * List files with a given prefix
   */
  listPrefix(prefix: string): string[] {
    return this.native.listPrefix(prefix);
  }

  /**
   * Open a SQLite database from the archive
   */
  openDatabase(dbPath: string): EngramDatabase {
    const nativeDb = this.native.openDatabase(dbPath);
    return new EngramDatabase(nativeDb);
  }

  /**
   * Read a file as UTF-8 text
   */
  async readText(path: string): Promise<string> {
    const buffer = await this.readFile(path);
    return buffer.toString('utf-8');
  }

  /**
   * Read a file as JSON
   */
  async readJson<T = any>(path: string): Promise<T> {
    const text = await this.readText(path);
    return JSON.parse(text);
  }
}

/**
 * SQLite database connection from archive
 */
export class EngramDatabase {
  constructor(private native: NativeDatabase) {}

  /**
   * Execute a query and return results
   */
  query<T = any>(sql: string, params?: any[]): T[] {
    const paramsJson = params ? JSON.stringify(params) : undefined;
    const resultJson = this.native.query(sql, paramsJson);
    return JSON.parse(resultJson) as T[];
  }

  /**
   * Execute a non-query SQL statement
   * @returns Number of rows affected
   */
  execute(sql: string, params?: any[]): number {
    const paramsJson = params ? JSON.stringify(params) : undefined;
    return this.native.execute(sql, paramsJson);
  }

  /**
   * Get a single row from a query
   */
  queryOne<T = any>(sql: string, params?: any[]): T | null {
    const results = this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get a single value from a query
   */
  queryValue<T = any>(sql: string, params?: any[]): T | null {
    const row = this.queryOne<Record<string, T>>(sql, params);
    if (!row) return null;
    const values = Object.values(row);
    return values.length > 0 ? values[0] : null;
  }

  /**
   * Check if a table exists
   */
  tableExists(tableName: string): boolean {
    const result = this.queryValue<number>(
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]
    );
    return result ? result > 0 : false;
  }
}

/**
 * Archive writer for creating .eng files
 */
export class EngramWriter {
  private native: NativeWriter;
  private finalized = false;

  constructor(path: string) {
    this.native = new NativeWriterImpl(path);
  }

  /**
   * Add a file to the archive
   */
  addFile(path: string, data: Buffer): void {
    this.checkNotFinalized();
    this.native.addFile(path, data);
  }

  /**
   * Add a file with specific compression
   */
  addFileWithCompression(
    path: string,
    data: Buffer,
    compression: CompressionMethodType
  ): void {
    this.checkNotFinalized();
    this.native.addFileWithCompression(path, data, compression);
  }

  /**
   * Add a file from disk
   */
  addFileFromDisk(archivePath: string, diskPath: string): void {
    this.checkNotFinalized();
    this.native.addFileFromDisk(archivePath, diskPath);
  }

  /**
   * Add text content as a file
   */
  addText(path: string, text: string): void {
    this.addFile(path, Buffer.from(text, 'utf-8'));
  }

  /**
   * Add JSON content as a file
   */
  addJson(path: string, data: any): void {
    const json = JSON.stringify(data, null, 2);
    this.addText(path, json);
  }

  /**
   * Add manifest.json from an object
   */
  addManifest(manifest: any): void {
    this.checkNotFinalized();
    const manifestJson = JSON.stringify(manifest);
    this.native.addManifest(manifestJson);
  }

  /**
   * Add a SQLite database from disk
   */
  addDatabase(archivePath: string, diskPath: string): void {
    this.addFileFromDisk(archivePath, diskPath);
  }

  /**
   * Finalize the archive (must be called before the writer is dropped)
   */
  finalize(): void {
    this.checkNotFinalized();
    this.native.finalize();
    this.finalized = true;
  }

  private checkNotFinalized(): void {
    if (this.finalized) {
      throw new Error('Writer already finalized');
    }
  }
}

/**
 * Manifest structure (optional, for type safety)
 */
export interface EngramManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  created?: string;
  [key: string]: any;
}

/**
 * Helper function to create a manifest
 */
export function createManifest(data: EngramManifest): EngramManifest {
  return {
    ...data,
    created: data.created || new Date().toISOString()
  };
}
