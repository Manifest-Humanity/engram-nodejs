// Type definitions for native bindings

export class EngramArchive {
  constructor(path: string);
  entryCount(): number;
  listFiles(): string[];
  contains(path: string): boolean;
  getMetadata(path: string): EntryMetadata | null;
  readFileSync(path: string): Buffer;
  readFile(path: string): Promise<Buffer>;
  readFiles(paths: string[]): Promise<Buffer[]>;
  readManifest(): string | null;
  listPrefix(prefix: string): string[];
  openDatabase(dbPath: string): EngramDatabase;
}

export class EngramWriter {
  constructor(path: string);
  addFile(path: string, data: Buffer): void;
  addFileWithCompression(path: string, data: Buffer, compression: CompressionMethod): void;
  addFileFromDisk(archivePath: string, diskPath: string): void;
  addManifest(manifest: string): void;
  finalize(): void;
}

export class EngramDatabase {
  query(sql: string, params?: string): string;
  execute(sql: string, params?: string): number;
}

export enum CompressionMethod {
  None = 0,
  Lz4 = 1,
  Zstd = 2,
  Deflate = 3,
}

export interface EntryMetadata {
  path: string;
  uncompressedSize: number;
  compressedSize: number;
  compressionMethod: string;
  modifiedTime: number;
}
