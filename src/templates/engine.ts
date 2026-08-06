import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config/schema';

/**
 * Translates Handlebars-style template syntax into EJS-style syntax.
 * Supports:
 * - {{#if condition}} -> <% if (condition) { %>
 * - {{else}} -> <% } else { %>
 * - {{/if}} -> <% } %>
 * - {{#each list}} -> <% if (typeof list !== "undefined" && Array.isArray(list)) { list.forEach(function(item) { with(item) { %>
 * - {{/each}} -> <% } }); } %>
 * - {{this}} -> <%= typeof item !== "undefined" ? item : "" %>
 * - {{variable}} -> <%= variable %>
 */
export function translateHandlebarsToEjs(templateText: string): string {
  let t = templateText;

  // Translate {{this}} first to prevent it being matched as a general variable
  t = t.replace(/\{\{\s*this\s*\}\}/g, '<%= typeof item !== "undefined" ? item : "" %>');

  // Translate {{#if cond}}
  t = t.replace(/\{\{#if\s+([\s\S]+?)\}\}/g, '<% if ($1) { %>');
  // Translate {{else}}
  t = t.replace(/\{\{\s*else\s*\}\}/g, '<% } else { %>');
  // Translate {{/if}}
  t = t.replace(/\{\{\s*\/if\s*\}\}/g, '<% } %>');

  // Translate {{#each expr}}
  t = t.replace(
    /\{\{#each\s+([\s\S]+?)\}\}/g,
    '<% if (typeof $1 !== "undefined" && Array.isArray($1)) { $1.forEach(function(item) { with(item) { %>',
  );
  // Translate {{/each}}
  t = t.replace(/\{\{\s*\/each\s*\}\}/g, '<% } }); } %>');

  // Translate general {{expr}}
  t = t.replace(/\{\{([\s\S]+?)\}\}/g, '<%= $1 %>');

  return t;
}

/**
 * Compiles template text (supporting both EJS-style and Handlebars-style tags)
 * into an executable JavaScript function.
 */
export function compileTemplate(templateText: string): (data: any) => string {
  const ejsText = translateHandlebarsToEjs(templateText);

  let code = 'let r = [];\n';
  code += 'const render = (context) => {\n';
  code += '  with(context || {}) {\n';

  // Split text by EJS tags <% ... %> and <%= ... %>
  const parts = ejsText.split(/(<%[\s\S]*?%>)/g);
  for (const part of parts) {
    if (part.startsWith('<%') && part.endsWith('%>')) {
      if (part.startsWith('<%=')) {
        const expr = part.substring(3, part.length - 2).trim();
        code += `    try { r.push(${expr}); } catch (e) {} \n`;
      } else {
        const stmt = part.substring(2, part.length - 2).trim();
        code += `    ${stmt}\n`;
      }
    } else {
      if (part) {
        const escaped = JSON.stringify(part);
        code += `    r.push(${escaped});\n`;
      }
    }
  }

  code += '  }\n';
  code += '};\n';
  code += 'render(data);\n';
  code += 'return r.join("");\n';

  try {
    return new Function('data', code) as (data: any) => string;
  } catch (err: any) {
    throw new Error(`Template compilation failed: ${err.message}\nCode:\n${code}`, { cause: err });
  }
}

export class TemplateEngine {
  private templatesDir: string;

  constructor(customTemplatesDir?: string) {
    if (customTemplatesDir) {
      this.templatesDir = path.resolve(customTemplatesDir);
    } else {
      const config = loadConfig();
      this.templatesDir = path.resolve(config.paths.templates_dir || '.stubs/templates');
    }
  }

  /**
   * Scans the templates directory recursively for files.
   * Returns empty array if directory doesn't exist, defining error out of existence.
   */
  public async listTemplates(): Promise<string[]> {
    if (!fs.existsSync(this.templatesDir)) {
      return [];
    }

    const files: string[] = [];
    const scan = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          files.push(path.relative(this.templatesDir, fullPath).replace(/\\/g, '/'));
        }
      }
    };

    await scan(this.templatesDir);
    return files;
  }

  /**
   * Resolves template name to its absolute file path.
   * Supports name with/without extensions.
   */
  public getTemplatePath(templateName: string): string {
    // If exact file exists, use it
    const filePath = path.resolve(this.templatesDir, templateName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    // Try typical extensions
    const extensions = ['.ts.md.tpl', '.md.tpl', '.tpl', '.ts.md', '.md'];
    for (const ext of extensions) {
      const testPath = path.resolve(this.templatesDir, `${templateName}${ext}`);
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    }

    return filePath;
  }

  /**
   * Renders a template stored in the templates directory.
   */
  public async renderTemplate(templateName: string, data: any): Promise<string> {
    const filePath = this.getTemplatePath(templateName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template not found: "${templateName}" in directory "${this.templatesDir}"`);
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    return this.renderString(content, data);
  }

  /**
   * Directly renders template content from a string.
   */
  public renderString(templateContent: string, data: any): string {
    const renderFn = compileTemplate(templateContent);
    return renderFn(data);
  }
}
