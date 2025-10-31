/**
 * Engram System - Virtual filesystem and SQLite access for .eng archives
 *
 * This module provides high-level TypeScript APIs for working with .eng archive files.
 */
import type { EngramDatabase as NativeDatabase } from './native';
export declare const CompressionMethod: any;
export type { EntryMetadata } from './native';
import type { CompressionMethod as CompressionMethodType, EntryMetadata as EntryMetadataType } from './native';
/**
 * Archive reader for accessing files and databases from .eng archives
 */
export declare class EngramArchive {
    private native;
    constructor(path: string);
    /**
     * Get the number of entries in the archive
     */
    get entryCount(): number;
    /**
     * List all file paths in the archive
     */
    listFiles(): string[];
    /**
     * Check if a file exists in the archive
     */
    contains(path: string): boolean;
    /**
     * Get metadata for a file
     */
    getMetadata(path: string): EntryMetadataType | null;
    /**
     * Read a file from the archive (synchronous)
     */
    readFileSync(path: string): Buffer;
    /**
     * Read a file from the archive (asynchronous)
     */
    readFile(path: string): Promise<Buffer>;
    /**
     * Read multiple files from the archive (batch operation)
     */
    readFiles(paths: string[]): Promise<Buffer[]>;
    /**
     * Read and parse manifest.json
     */
    readManifest(): any | null;
    /**
     * List files with a given prefix
     */
    listPrefix(prefix: string): string[];
    /**
     * Open a SQLite database from the archive
     */
    openDatabase(dbPath: string): EngramDatabase;
    /**
     * Read a file as UTF-8 text
     */
    readText(path: string): Promise<string>;
    /**
     * Read a file as JSON
     */
    readJson<T = any>(path: string): Promise<T>;
}
/**
 * SQLite database connection from archive
 */
export declare class EngramDatabase {
    private native;
    constructor(native: NativeDatabase);
    /**
     * Execute a query and return results
     */
    query<T = any>(sql: string, params?: any[]): T[];
    /**
     * Execute a non-query SQL statement
     * @returns Number of rows affected
     */
    execute(sql: string, params?: any[]): number;
    /**
     * Get a single row from a query
     */
    queryOne<T = any>(sql: string, params?: any[]): T | null;
    /**
     * Get a single value from a query
     */
    queryValue<T = any>(sql: string, params?: any[]): T | null;
    /**
     * Check if a table exists
     */
    tableExists(tableName: string): boolean;
}
/**
 * Archive writer for creating .eng files
 */
export declare class EngramWriter {
    private native;
    private finalized;
    constructor(path: string);
    /**
     * Add a file to the archive
     */
    addFile(path: string, data: Buffer): void;
    /**
     * Add a file with specific compression
     */
    addFileWithCompression(path: string, data: Buffer, compression: CompressionMethodType): void;
    /**
     * Add a file from disk
     */
    addFileFromDisk(archivePath: string, diskPath: string): void;
    /**
     * Add text content as a file
     */
    addText(path: string, text: string): void;
    /**
     * Add JSON content as a file
     */
    addJson(path: string, data: any): void;
    /**
     * Add manifest.json from an object
     */
    addManifest(manifest: any): void;
    /**
     * Add a SQLite database from disk
     */
    addDatabase(archivePath: string, diskPath: string): void;
    /**
     * Finalize the archive (must be called before the writer is dropped)
     */
    finalize(): void;
    private checkNotFinalized;
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
export declare function createManifest(data: EngramManifest): EngramManifest;
