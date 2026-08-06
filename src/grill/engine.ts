import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yaml from 'js-yaml';
import { loadConfig } from '../config/schema';
import { parseOkfSpec, OkfFrontmatter } from '../parser/okf';
import { GraphEngine } from '../graph/engine';

export type GrillState =
  'INIT' | 'PARSING' | 'GENERATING_QUESTIONS' | 'GRILLING' | 'SAVING' | 'DONE' | 'ERROR';

export interface GrillEngineOptions {
  depth?: 'light_probe' | 'standard_drill' | 'deep_interrogation';
  configPath?: string;
  nonInteractive?: boolean;
  answers?: string[];
  onStateChange?: (state: GrillState) => void;
}

export class GrillEngine {
  private state: GrillState = 'INIT';
  private onStateChange?: (state: GrillState) => void;

  constructor() {}

  /**
   * Retrieves the current state of the grill state machine.
   */
  public getState(): GrillState {
    return this.state;
  }

  private transition(newState: GrillState) {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }

  /**
   * Executes the Interactive Grill Engine state machine.
   * Conforms to the 3-level Grill Depth Matrix and handles sidecar file updates.
   */
  public async grill(filePath: string, options: GrillEngineOptions = {}): Promise<void> {
    this.onStateChange = options.onStateChange;
    this.transition('INIT');

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      this.transition('ERROR');
      throw new Error(`File not found: ${filePath}`);
    }

    const config = loadConfig(options.configPath);
    const depth = options.depth || config.grill.default_depth || 'standard_drill';

    // 1. Parsing state
    this.transition('PARSING');
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const parseResult = parseOkfSpec(content);

    if (!parseResult.isValid || !parseResult.frontmatter) {
      this.transition('ERROR');
      throw new Error(`Invalid OKF specification file: ${parseResult.errors.join(', ')}`);
    }

    const { frontmatter, body } = parseResult;

    // Transition physical file status to 'grilling' before commencing questions
    const originalStatus = frontmatter.status;
    frontmatter.status = 'grilling';
    const intermediateContent = `---\n${yaml.dump(frontmatter).trim()}\n---\n${body}`;
    fs.writeFileSync(resolvedPath, intermediateContent, 'utf8');

    // 2. Generating Questions state
    this.transition('GENERATING_QUESTIONS');
    const questions = this.generateQuestions(frontmatter, body, depth);

    // 3. Grilling state (interactive or non-interactive prompting)
    this.transition('GRILLING');
    const answers: string[] = [];

    if (options.nonInteractive) {
      // In non-interactive mode, use provided answers or auto-fill them
      for (let i = 0; i < questions.length; i++) {
        const providedAnswer = options.answers && options.answers[i];
        const ans = providedAnswer || `[Automated reply to: ${questions[i].substring(0, 30)}...]`;
        answers.push(ans);
      }
    } else {
      // Interactive mode using readline
      const rl = readline.createInterface({
        input: process.stdin as any,
        output: process.stdout as any,
      });

      const askQuestion = (query: string): Promise<string> => {
        return new Promise((resolve) => {
          rl.question(`\nQuestion: ${query}\n> `, (answer) => {
            resolve(answer.trim() || 'N/A');
          });
        });
      };

      console.log(`\n======================================================`);
      console.log(`   STUBS INTERACTIVE GRILL ENGINE [Depth: ${depth}]`);
      console.log(`   Targeting: ${frontmatter.title}`);
      console.log(`======================================================`);

      for (const q of questions) {
        const ans = await askQuestion(q);
        answers.push(ans);
      }
      rl.close();
    }

    // 4. Saving state
    this.transition('SAVING');

    // Create user_notes in frontmatter for each Q&A pair
    const timestamp = new Date().toISOString();
    const notes = frontmatter.user_notes || [];

    questions.forEach((q, idx) => {
      notes.push({
        id: `NOTE-GRILL-${Date.now()}-${idx}`,
        timestamp,
        text: `Q: ${q} | A: ${answers[idx]}`,
        status: 'resolved',
      });
    });
    frontmatter.user_notes = notes;

    // Transition status back to spec (or implemented if already done)
    frontmatter.status = originalStatus === 'grilling' ? 'spec' : originalStatus;

    // Append beautiful markdown log to body
    let qaLog = `\n\n## Grilling & Discussion (${this.formatDepthName(depth)})\n\n`;
    qaLog += `**Date:** ${new Date().toLocaleDateString()}  \n`;
    qaLog += `**Depth:** ${depth}  \n\n`;
    questions.forEach((q, idx) => {
      qaLog += `* **Q:** _${q}_\n  **A:** ${answers[idx]}\n\n`;
    });

    const updatedBody = body + qaLog;
    const finalContent = `---\n${yaml.dump(frontmatter).trim()}\n---\n${updatedBody}`;

    fs.writeFileSync(resolvedPath, finalContent, 'utf8');

    // Re-index sidecar via GraphEngine
    try {
      const graphEngine = new GraphEngine(config.paths.db_path);
      await graphEngine.initialize();
      await graphEngine.upsertSidecar({
        filePath: path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/'),
        frontmatter,
        body: updatedBody,
      });
      await graphEngine.close();
    } catch (dbErr: any) {
      console.error(`Warning: Failed to re-index grilled sidecar: ${dbErr.message}`);
    }

    // 5. Done state
    this.transition('DONE');
    if (!options.nonInteractive) {
      console.log(`\n✔ Grilling completed successfully! Sidecar updated & indexed.`);
      console.log(`======================================================\n`);
    }
  }

  private generateQuestions(
    frontmatter: OkfFrontmatter,
    body: string,
    depth: 'light_probe' | 'standard_drill' | 'deep_interrogation',
  ): string[] {
    const questions: string[] = [];
    const exportsList = frontmatter.exports || [];
    const exportsText = exportsList.length > 0 ? ` (${exportsList.join(', ')})` : '';

    // Level 1: Light Probe (1-2 questions) focus on inputs, outputs, basic happy-path signatures.
    const q1 = `Regarding the module's public interface${exportsText}: what are the primary input parameters and expected happy-path output types/values?`;
    const q2 = `What are the input validation rules and constraint boundaries (e.g., format, value ranges, size limits) for this interface?`;

    // Level 2: Standard Drill (2-4 questions) adds deep module interface, error elimination, Context Objects.
    const q3 = frontmatter.context_object
      ? `How does the context object \`${frontmatter.context_object}\` capture environment and security variables to prevent parameter cluttering?`
      : `Should a Context Object be introduced to group configuration, session, or security parameters instead of passing them individually?`;
    const q4 = `How does this module "define errors out of existence" internally (e.g., favoring idempotent behaviors, explicit Result types, or null-objects over throwing exceptions)?`;

    // Level 3: Deep Interrogation (4-6 questions) adds ADR trade-offs, race conditions, security, cascade risks.
    const q5 =
      frontmatter.decisions && frontmatter.decisions.length > 0
        ? `Looking at your recorded decisions (${frontmatter.decisions.map((d) => d.id).join(', ')}): what are the critical architectural trade-offs of these choices?`
        : `No Architectural Decision Records (ADRs) are documented. What are the key architectural decisions and engineering trade-offs made in this design?`;
    const q6 = `How does this module handle potential concurrent execution, race conditions, or state synchronization issues under heavy load?`;
    const q7 = `What are the potential security boundaries (e.g., privilege checks, injection risks) and how does the implementation guard against them?`;

    if (depth === 'light_probe') {
      questions.push(q1, q2);
    } else if (depth === 'standard_drill') {
      questions.push(q1, q2, q3, q4);
    } else {
      // deep_interrogation
      questions.push(q1, q3, q4, q5, q6, q7);
    }

    return questions;
  }

  private formatDepthName(depth: string): string {
    return depth
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
