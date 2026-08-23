import * as yaml from 'js-yaml';

export interface OkfFrontmatter {
  title: string;
  type:
    | 'subsystem-index'
    | 'sidecar-spec'
    | 'module-stub'
    | 'concept-doc'
    | 'architecture-decision'
    | 'architecture-doc';
  description: string;
  tags: string[];
  module_depth?: 'deep' | 'shallow';
  context_object?: string;
  template_source?: string;
  template_version?: number | string;
  status:
    'skeleton' | 'spec' | 'implemented' | 'materialized' | 'grilling' | 'partially-materialized';
  version: number;
  target_code_file?: string;
  exports?: string[];
  depends_on?: string[];
  used_by?: string[];
  status_flag:
    | 'clean'
    | 'dependency-stale'
    | 'template-outdated'
    | 'template-realign-required'
    | 'needs-human-review-resolution'
    | 'typecheck-failed';
  stale_details?: string | null;
  sync_state?: {
    last_sync_timestamp: string;
    sidecar_hash: string;
    code_hash: string;
  };
  decisions?: Array<{
    id: string;
    summary: string;
    date: string;
  }>;
  user_notes?: Array<{
    id: string;
    timestamp: string;
    text: string;
    status: string;
  }>;
}

export interface ParsedOkfSpec {
  frontmatter: OkfFrontmatter | null;
  body: string;
  isValid: boolean;
  errors: string[];
}

/**
 * Checks if a spec represents an executable code sidecar rather than a pure concept document.
 */
export function isCodeSidecar(frontmatter: OkfFrontmatter | null, filePath?: string): boolean {
  if (frontmatter?.target_code_file) {
    return true;
  }
  if (frontmatter?.type === 'sidecar-spec' || frontmatter?.type === 'module-stub') {
    return true;
  }
  if (filePath) {
    const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
    // Matches patterns like foo.ts.md, service.py.md, handler.go.md (has an inner extension before .md)
    if (/\.[a-zA-Z0-9_-]+\.md$/i.test(base)) {
      return true;
    }
  }
  return false;
}

/**
 * Parses and validates an OKF specification file containing YAML frontmatter and Markdown body.
 * Pulls all string splitting, YAML parsing, and structural validation complexity downward.
 */
export function parseOkfSpec(content: string): ParsedOkfSpec {
  const result: ParsedOkfSpec = {
    frontmatter: null,
    body: '',
    isValid: false,
    errors: [],
  };

  if (!content) {
    result.errors.push('File content is empty.');
    return result;
  }

  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n');

  // Match YAML frontmatter between "---" markers
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    result.errors.push(
      'Invalid OKF format: File must start with a YAML frontmatter block enclosed in "---" markers.',
    );
    result.body = normalized;
    return result;
  }

  const yamlText = frontmatterMatch[1].trim();
  result.body = frontmatterMatch[2];

  let parsedYaml: any;
  try {
    parsedYaml = yaml.load(yamlText);
  } catch (err: any) {
    result.errors.push(`YAML parsing failed: ${err.message || err}`);
    return result;
  }

  if (!parsedYaml || typeof parsedYaml !== 'object') {
    result.errors.push('YAML frontmatter is not a valid object.');
    return result;
  }

  // Validate fields
  validateFrontmatter(parsedYaml, result);

  if (result.errors.length === 0) {
    result.isValid = true;
    result.frontmatter = parsedYaml as OkfFrontmatter;
  }

  return result;
}

function validateFrontmatter(raw: any, result: ParsedOkfSpec): void {
  // Required fields (target_code_file is optional for pure concept documentation)
  const requiredFields = [
    'title',
    'type',
    'description',
    'tags',
    'status',
    'version',
    'status_flag',
  ];
  for (const field of requiredFields) {
    if (raw[field] === undefined || raw[field] === null) {
      result.errors.push(`Missing required field: "${field}"`);
    }
  }

  // Check types and values if they exist
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    result.errors.push('Field "title" must be a string.');
  }

  const validTypes = [
    'subsystem-index',
    'sidecar-spec',
    'module-stub',
    'concept-doc',
    'architecture-decision',
    'architecture-doc',
  ];
  if (raw.type !== undefined && !validTypes.includes(raw.type)) {
    result.errors.push(`Field "type" must be one of: ${validTypes.join(', ')}.`);
  }

  if (raw.description !== undefined && typeof raw.description !== 'string') {
    result.errors.push('Field "description" must be a string.');
  }

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((t: any) => typeof t === 'string')) {
      result.errors.push('Field "tags" must be an array of strings.');
    }
  }

  if (raw.module_depth !== undefined) {
    const validDepths = ['deep', 'shallow'];
    if (!validDepths.includes(raw.module_depth)) {
      result.errors.push(`Field "module_depth" must be one of: ${validDepths.join(', ')}.`);
    }
  }

  if (raw.context_object !== undefined && typeof raw.context_object !== 'string') {
    result.errors.push('Field "context_object" must be a string.');
  }

  if (raw.template_source !== undefined && typeof raw.template_source !== 'string') {
    result.errors.push('Field "template_source" must be a string.');
  }

  if (
    raw.template_version !== undefined &&
    typeof raw.template_version !== 'number' &&
    typeof raw.template_version !== 'string'
  ) {
    result.errors.push('Field "template_version" must be a number or a string.');
  }

  const validStatuses = [
    'skeleton',
    'spec',
    'implemented',
    'materialized',
    'grilling',
    'partially-materialized',
  ];
  if (raw.status !== undefined && !validStatuses.includes(raw.status)) {
    result.errors.push(`Field "status" must be one of: ${validStatuses.join(', ')}.`);
  }

  if (raw.version !== undefined && typeof raw.version !== 'number') {
    result.errors.push('Field "version" must be a number.');
  }

  if (raw.target_code_file !== undefined && typeof raw.target_code_file !== 'string') {
    result.errors.push('Field "target_code_file" must be a string.');
  }

  if (raw.exports !== undefined) {
    if (!Array.isArray(raw.exports) || !raw.exports.every((e: any) => typeof e === 'string')) {
      result.errors.push('Field "exports" must be an array of strings.');
    }
  }

  if (raw.depends_on !== undefined) {
    if (
      !Array.isArray(raw.depends_on) ||
      !raw.depends_on.every((d: any) => typeof d === 'string')
    ) {
      result.errors.push('Field "depends_on" must be an array of strings.');
    }
  }

  if (raw.used_by !== undefined) {
    if (!Array.isArray(raw.used_by) || !raw.used_by.every((u: any) => typeof u === 'string')) {
      result.errors.push('Field "used_by" must be an array of strings.');
    }
  }

  const validStatusFlags = [
    'clean',
    'dependency-stale',
    'template-outdated',
    'template-realign-required',
    'needs-human-review-resolution',
    'typecheck-failed',
  ];
  if (raw.status_flag !== undefined && !validStatusFlags.includes(raw.status_flag)) {
    result.errors.push(`Field "status_flag" must be one of: ${validStatusFlags.join(', ')}.`);
  }

  if (
    raw.stale_details !== undefined &&
    raw.stale_details !== null &&
    typeof raw.stale_details !== 'string'
  ) {
    result.errors.push('Field "stale_details" must be a string or null.');
  }

  if (raw.sync_state !== undefined && raw.sync_state !== null) {
    if (typeof raw.sync_state !== 'object') {
      result.errors.push('Field "sync_state" must be an object.');
    } else {
      const state = raw.sync_state;
      if (typeof state.last_sync_timestamp !== 'string') {
        result.errors.push('Field "sync_state.last_sync_timestamp" must be a string.');
      }
      if (typeof state.sidecar_hash !== 'string') {
        result.errors.push('Field "sync_state.sidecar_hash" must be a string.');
      }
      if (typeof state.code_hash !== 'string') {
        result.errors.push('Field "sync_state.code_hash" must be a string.');
      }
    }
  }

  if (raw.decisions !== undefined) {
    if (!Array.isArray(raw.decisions)) {
      result.errors.push('Field "decisions" must be an array.');
    } else {
      raw.decisions.forEach((dec: any, index: number) => {
        if (!dec || typeof dec !== 'object') {
          result.errors.push(`decisions[${index}] must be an object.`);
        } else {
          if (typeof dec.id !== 'string') {
            result.errors.push(`decisions[${index}].id must be a string.`);
          }
          if (typeof dec.summary !== 'string') {
            result.errors.push(`decisions[${index}].summary must be a string.`);
          }
          if (typeof dec.date !== 'string') {
            result.errors.push(`decisions[${index}].date must be a string.`);
          }
        }
      });
    }
  }

  if (raw.user_notes !== undefined) {
    if (!Array.isArray(raw.user_notes)) {
      result.errors.push('Field "user_notes" must be an array.');
    } else {
      raw.user_notes.forEach((note: any, index: number) => {
        if (!note || typeof note !== 'object') {
          result.errors.push(`user_notes[${index}] must be an object.`);
        } else {
          if (typeof note.id !== 'string') {
            result.errors.push(`user_notes[${index}].id must be a string.`);
          }
          if (typeof note.timestamp !== 'string') {
            result.errors.push(`user_notes[${index}].timestamp must be a string.`);
          }
          if (typeof note.text !== 'string') {
            result.errors.push(`user_notes[${index}].text must be a string.`);
          }
          if (typeof note.status !== 'string') {
            result.errors.push(`user_notes[${index}].status must be a string.`);
          }
        }
      });
    }
  }
}
