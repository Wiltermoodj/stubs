// Debug AST structural hash for conflict detection
const ts = require('typescript');
const crypto = require('crypto');

// Inline getAstStructuralHash (same as src/sanding/ast.ts)
function getAstStructuralHash(code) {
  const sourceFile = ts.createSourceFile('file.ts', code, ts.ScriptTarget.Latest, true);
  const nodes = [];
  function visit(node) {
    let detail = '';
    if (ts.isIdentifier(node)) {
      detail = ':' + node.text;
    }
    nodes.push(ts.SyntaxKind[node.kind] + detail);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const serialized = nodes.join(',');
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

const code1 = 'export function greet(name: string): string { return "hello, " + name; }';
const code2 = 'export function greet(): string { return "v2"; }';

const h1 = getAstStructuralHash(code1);
const h2 = getAstStructuralHash(code2);
console.log('hash1:', h1);
console.log('hash2:', h2);
console.log('match:', h1 === h2);

// Show node serialization
function debugSerialize(code) {
  const sf = ts.createSourceFile('f.ts', code, ts.ScriptTarget.Latest, true);
  const nodes = [];
  function visit(n) {
    let d = '';
    if (ts.isIdentifier(n)) d = ':' + n.text;
    nodes.push(ts.SyntaxKind[n.kind] + d);
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return nodes.join(',');
}
console.log('nodes1:', debugSerialize(code1));
console.log('nodes2:', debugSerialize(code2));
