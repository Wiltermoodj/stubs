import { SearchOptions, SearchResult, GraphEngine } from '../engine';

export interface SearchPlugin {
  /**
   * Generates a vector embedding for a given text.
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generates and stores the vector embedding for a given sidecar file.
   */
  indexSidecar(filePath: string, textToEmbed: string): Promise<void>;

  /**
   * Executes a vector-based similarity search.
   */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

export abstract class BaseSearchPlugin implements SearchPlugin {
  protected engine: GraphEngine;
  protected pluginEngineName: 'level-2' | 'level-3';

  constructor(engine: GraphEngine, pluginEngineName: 'level-2' | 'level-3') {
    this.engine = engine;
    this.pluginEngineName = pluginEngineName;
  }

  abstract generateEmbedding(text: string): Promise<number[]>;

  public async indexSidecar(filePath: string, textToEmbed: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(textToEmbed);
      const embeddingJson = JSON.stringify(embedding);

      await this.engine.run(
        `INSERT OR REPLACE INTO sidecar_embeddings (file_path, engine, embedding)
         VALUES (?, ?, ?);`,
        [filePath, this.pluginEngineName, embeddingJson],
      );
    } catch (err: any) {
      // Define errors out of existence: log/handle silently without crashing the main flow
      console.warn(
        `[SearchPlugin:${this.pluginEngineName}] Failed to index sidecar "${filePath}":`,
        err.message || err,
      );
    }
  }

  public abstract search(query: string, options: SearchOptions): Promise<SearchResult[]>;

  /**
   * Utility to compute cosine similarity between two vectors of the same dimension.
   */
  protected cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
