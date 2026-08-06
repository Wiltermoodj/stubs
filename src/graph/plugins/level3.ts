import { BaseSearchPlugin } from './base';
import { SearchOptions, SearchResult } from '../engine';

export class Level3SearchPlugin extends BaseSearchPlugin {
  private pipeline: any = null;
  private hasTransformers = false;
  private hasSqliteVec = false;
  private initPromise: Promise<void>;

  constructor(engine: any) {
    super(engine, 'level-3');
    this.initPromise = this.initOptionalDependencies();
  }

  private async initOptionalDependencies(): Promise<void> {
    try {
      // Attempt dynamic loading of @xenova/transformers
      const { pipeline } = await import('@xenova/transformers' as any);
      this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.hasTransformers = true;
    } catch {
      // Graceful fallback to JS/TS representation
    }

    try {
      // Attempt to load sqlite-vec extension
      const sqliteVec = await import('sqlite-vec' as any);
      const loadPath = sqliteVec.getLoadablePath();
      // Load into the sqlite database
      // Since sqlite3 in node supports loadExtension if compiled with it:
      const db = (this.engine as any).db;
      if (db && typeof db.loadExtension === 'function') {
        db.loadExtension(loadPath);
        this.hasSqliteVec = true;
      }
    } catch {
      // Graceful fallback to JS/TS cosine similarity
    }
  }

  /**
   * Generates a vector embedding using @xenova/transformers if available,
   * otherwise falls back to our robust deterministic mock embedding.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    await this.initPromise;
    if (this.hasTransformers && this.pipeline) {
      try {
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
      } catch (err: any) {
        console.warn(
          `[Level3SearchPlugin] Failed to generate embedding with transformers:`,
          err.message || err,
        );
      }
    }
    return this.generateMockEmbedding(text);
  }

  /**
   * Executes local vector similarity search.
   */
  public async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    await this.initPromise;
    const queryVector = await this.generateEmbedding(query);

    // Retrieve all Level 3 embeddings
    const rows = await this.engine.all<{
      file_path: string;
      title: string;
      description: string;
      type: string;
      status: string;
      status_flag: string;
      embedding: string;
    }>(
      `SELECT s.file_path, s.title, s.description, s.type, s.status, s.status_flag, se.embedding
       FROM sidecars s
       JOIN sidecar_embeddings se ON s.file_path = se.file_path
       WHERE se.engine = 'level-3';`,
    );

    const results: SearchResult[] = [];

    for (const row of rows) {
      if (options.candidateFiles && !options.candidateFiles.has(row.file_path)) {
        continue;
      }

      let docVector: number[];
      try {
        docVector = JSON.parse(row.embedding);
      } catch {
        continue;
      }

      const similarity = this.cosineSimilarity(queryVector, docVector);

      results.push({
        filePath: row.file_path,
        title: row.title || '',
        description: row.description || '',
        type: row.type || '',
        status: row.status || '',
        status_flag: row.status_flag || '',
        rank: similarity,
      });
    }

    // Sort descending by rank (similarity)
    results.sort((a, b) => (b.rank || 0) - (a.rank || 0));

    if (options.limit !== undefined && options.limit > 0) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  private generateMockEmbedding(text: string): number[] {
    // Generate a 384-dimensional vector (typical for MiniLM-L6)
    const dim = 384;
    const vec = new Array(dim).fill(0);
    const cleaned = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let i = 0; i < cleaned.length; i++) {
      const charCode = cleaned.charCodeAt(i);
      vec[charCode % dim] += charCode;
    }
    const sumSq = vec.reduce((sum, val) => sum + val * val, 0);
    const mag = Math.sqrt(sumSq) || 1;
    return vec.map((v) => v / mag);
  }
}
