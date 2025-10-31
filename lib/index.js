"use strict";
/**
 * Engram System - Virtual filesystem and SQLite access for .eng archives
 *
 * This module provides high-level TypeScript APIs for working with .eng archive files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngramWriter = exports.EngramDatabase = exports.EngramArchive = exports.CompressionMethod = void 0;
exports.createManifest = createManifest;
// Load the actual native module at runtime
const nativeModule = require('../dist/index.js');
const NativeArchiveImpl = nativeModule.EngramArchive;
const NativeWriterImpl = nativeModule.EngramWriter;
const NativeDatabaseImpl = nativeModule.EngramDatabase;
// Re-export native enums and interfaces
exports.CompressionMethod = nativeModule.CompressionMethod;
/**
 * Archive reader for accessing files and databases from .eng archives
 */
class EngramArchive {
    constructor(path) {
        this.native = new NativeArchiveImpl(path);
    }
    /**
     * Get the number of entries in the archive
     */
    get entryCount() {
        return this.native.entryCount();
    }
    /**
     * List all file paths in the archive
     */
    listFiles() {
        return this.native.listFiles();
    }
    /**
     * Check if a file exists in the archive
     */
    contains(path) {
        return this.native.contains(path);
    }
    /**
     * Get metadata for a file
     */
    getMetadata(path) {
        return this.native.getMetadata(path);
    }
    /**
     * Read a file from the archive (synchronous)
     */
    readFileSync(path) {
        return this.native.readFileSync(path);
    }
    /**
     * Read a file from the archive (asynchronous)
     */
    async readFile(path) {
        return await this.native.readFile(path);
    }
    /**
     * Read multiple files from the archive (batch operation)
     */
    async readFiles(paths) {
        return await this.native.readFiles(paths);
    }
    /**
     * Read and parse manifest.json
     */
    readManifest() {
        const manifestJson = this.native.readManifest();
        if (!manifestJson)
            return null;
        return JSON.parse(manifestJson);
    }
    /**
     * List files with a given prefix
     */
    listPrefix(prefix) {
        return this.native.listPrefix(prefix);
    }
    /**
     * Open a SQLite database from the archive
     */
    openDatabase(dbPath) {
        const nativeDb = this.native.openDatabase(dbPath);
        return new EngramDatabase(nativeDb);
    }
    /**
     * Read a file as UTF-8 text
     */
    async readText(path) {
        const buffer = await this.readFile(path);
        return buffer.toString('utf-8');
    }
    /**
     * Read a file as JSON
     */
    async readJson(path) {
        const text = await this.readText(path);
        return JSON.parse(text);
    }
}
exports.EngramArchive = EngramArchive;
/**
 * SQLite database connection from archive
 */
class EngramDatabase {
    constructor(native) {
        this.native = native;
    }
    /**
     * Execute a query and return results
     */
    query(sql, params) {
        const paramsJson = params ? JSON.stringify(params) : undefined;
        const resultJson = this.native.query(sql, paramsJson);
        return JSON.parse(resultJson);
    }
    /**
     * Execute a non-query SQL statement
     * @returns Number of rows affected
     */
    execute(sql, params) {
        const paramsJson = params ? JSON.stringify(params) : undefined;
        return this.native.execute(sql, paramsJson);
    }
    /**
     * Get a single row from a query
     */
    queryOne(sql, params) {
        const results = this.query(sql, params);
        return results.length > 0 ? results[0] : null;
    }
    /**
     * Get a single value from a query
     */
    queryValue(sql, params) {
        const row = this.queryOne(sql, params);
        if (!row)
            return null;
        const values = Object.values(row);
        return values.length > 0 ? values[0] : null;
    }
    /**
     * Check if a table exists
     */
    tableExists(tableName) {
        const result = this.queryValue("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", [tableName]);
        return result ? result > 0 : false;
    }
}
exports.EngramDatabase = EngramDatabase;
/**
 * Archive writer for creating .eng files
 */
class EngramWriter {
    constructor(path) {
        this.finalized = false;
        this.native = new NativeWriterImpl(path);
    }
    /**
     * Add a file to the archive
     */
    addFile(path, data) {
        this.checkNotFinalized();
        this.native.addFile(path, data);
    }
    /**
     * Add a file with specific compression
     */
    addFileWithCompression(path, data, compression) {
        this.checkNotFinalized();
        this.native.addFileWithCompression(path, data, compression);
    }
    /**
     * Add a file from disk
     */
    addFileFromDisk(archivePath, diskPath) {
        this.checkNotFinalized();
        this.native.addFileFromDisk(archivePath, diskPath);
    }
    /**
     * Add text content as a file
     */
    addText(path, text) {
        this.addFile(path, Buffer.from(text, 'utf-8'));
    }
    /**
     * Add JSON content as a file
     */
    addJson(path, data) {
        const json = JSON.stringify(data, null, 2);
        this.addText(path, json);
    }
    /**
     * Add manifest.json from an object
     */
    addManifest(manifest) {
        this.checkNotFinalized();
        const manifestJson = JSON.stringify(manifest);
        this.native.addManifest(manifestJson);
    }
    /**
     * Add a SQLite database from disk
     */
    addDatabase(archivePath, diskPath) {
        this.addFileFromDisk(archivePath, diskPath);
    }
    /**
     * Finalize the archive (must be called before the writer is dropped)
     */
    finalize() {
        this.checkNotFinalized();
        this.native.finalize();
        this.finalized = true;
    }
    checkNotFinalized() {
        if (this.finalized) {
            throw new Error('Writer already finalized');
        }
    }
}
exports.EngramWriter = EngramWriter;
/**
 * Helper function to create a manifest
 */
function createManifest(data) {
    return {
        ...data,
        created: data.created || new Date().toISOString()
    };
}
