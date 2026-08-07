import { GraphEngine } from './engine';
import { FileStorageDriver, WasmSqliteDriver, MemoryVirtualFileSystemDriver } from '../storage';

export interface WasmGraphEngineOptions {
  fsDriver?: FileStorageDriver;
  dbPath?: string;
  initialDbData?: Uint8Array;
}

export class WasmGraphEngine extends GraphEngine {
  constructor(options: WasmGraphEngineOptions = {}) {
    const fsDriver = options.fsDriver || new MemoryVirtualFileSystemDriver();
    const dbPath = options.dbPath || '.stubs/graph.sqlite';
    const dbDriver = new WasmSqliteDriver({
      dbPath,
      fsDriver,
      initialData: options.initialDbData,
    });

    super({
      fsDriver,
      dbDriver,
      dbPath,
    });
  }
}
