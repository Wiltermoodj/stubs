import * as ts from 'typescript';
import { getAstStructuralHash } from './src/sanding/ast';

const code1 = 'export function greet(name: string): string { return "hello, " + name; }';
const code2 = 'export function greet(): string { return "v2"; }';

console.log('hash1:', getAstStructuralHash(code1));
console.log('hash2:', getAstStructuralHash(code2));
console.log('match:', getAstStructuralHash(code1) === getAstStructuralHash(code2));

// Also show the node serialization for debugging
function debugSerialize(code: string) {
  const sourceFile = ts.createSourceFile('file.ts', code, ts.ScriptTarget.Latest, true);
  const nodes: string[] = [];
  function visit(node: ts.Node) {
    let detail = '';
    if (ts.isIdentifier(node)) {
      detail = `:${node.text}`;
    }
    nodes.push(`${node.kind}${detail}`);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return nodes.join(',');
}
console.log('nodes1:', debugSerialize(code1));
console.log('nodes2:', debugSerialize(code2));
