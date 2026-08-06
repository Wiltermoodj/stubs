import { BaseSearchPlugin } from './base';
import { SearchOptions, SearchResult } from '../engine';

export class Level2SearchPlugin extends BaseSearchPlugin {
  constructor(engine: any) {
    super(engine, 'level-2');
  }

  /**
   * Generates a vector embedding using host-configured OpenAI-compatible API,
   * falling back to a deterministic local mock embedding if keys are missing or requests fail.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this.generateMockEmbedding(text);
    }

    try {
      // Perform direct HTTP post fetch request with a timeout
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-3-small',
        }),
        signal: controller.signal,
      });

      clearTimeout(id);

      if (!response.ok) {
        throw new Error(`OpenAI API returned status ${response.status}`);
      }

      const data: any = await response.json();
      if (data && data.data && data.data[0] && data.data[0].embedding) {
        return data.data[0].embedding;
      }
      throw new Error('Invalid response structure from OpenAI embeddings API');
    } catch (err: any) {
      console.warn(
        `[Level2SearchPlugin] External API call failed, falling back to mock embedding:`,
        err.message || err,
      );
      return this.generateMockEmbedding(text);
    }
  }

  /**
   * Executes vector search ranking.
   */
  public async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const queryVector = await this.generateEmbedding(query);

    // Retrieve all Level 2 embeddings
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
       WHERE se.engine = 'level-2';`,
    );

    const results: SearchResult[] = [];

    for (const row of rows) {
      // If candidates are pre-filtered, skip non-candidates
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
        rank: similarity, // For vector search, we rank descending by similarity score
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
    const vec = new Array(1536).fill(0);
    const cleaned = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let i = 0; i < cleaned.length; i++) {
      const charCode = cleaned.charCodeAt(i);
      vec[charCode % 1536] += charCode;
    }
    const sumSq = vec.reduce((sum, val) => sum + val * val, 0);
    const mag = Math.sqrt(sumSq) || 1;
    return vec.map((v) => v / mag);
  }
}
