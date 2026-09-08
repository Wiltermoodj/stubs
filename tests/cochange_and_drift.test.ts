import { TopologyEngine, GraphNode } from '../src/graph/topology';
import { checkInterfaceDrift } from '../src/sanding/ast';

describe('Additional Refinements: Co-Change Analysis & Interface Drift', () => {
  describe('Git Co-Change Temporal Coupling', () => {
    it('calculates co-change correlation and confidence across commits', () => {
      const nodes: GraphNode[] = [
        { id: 'src/auth/jwt.ts', file_path: 'src/auth/jwt.ts', kind: 'file' },
        { id: 'tests/jwt.mock.ts', file_path: 'tests/jwt.mock.ts', kind: 'file' },
        { id: 'src/unrelated.ts', file_path: 'src/unrelated.ts', kind: 'file' },
      ];

      const topology = new TopologyEngine(nodes, []);

      const commitSets = [
        ['src/auth/jwt.ts', 'tests/jwt.mock.ts'],
        ['src/auth/jwt.ts', 'tests/jwt.mock.ts'],
        ['src/auth/jwt.ts', 'src/unrelated.ts'],
        ['src/other.ts'],
      ];

      const res = topology.analyzeCoChanges(commitSets, 'src/auth/jwt.ts', 2);

      expect(res.totalCommitsAnalyzed).toBe(4);
      expect(res.relatedFiles.length).toBe(1);
      expect(res.relatedFiles[0].fileB).toBe('tests/jwt.mock.ts');
      expect(res.relatedFiles[0].coChangeCount).toBe(2);
      expect(res.relatedFiles[0].confidence).toBe(0.67);
    });
  });

  describe('Interface Signature Drift Detection', () => {
    it('detects when declared exports in sidecar differ from actual TypeScript code', () => {
      const declaredExports = ['OldService', 'deprecatedHelper'];
      const sourceCode = `
export class NewService {}
export function helperFunc() {}
`;

      const report = checkInterfaceDrift(declaredExports, sourceCode, 'service.ts');

      expect(report.hasDrift).toBe(true);
      expect(report.missingInCode).toEqual(['OldService', 'deprecatedHelper']);
      expect(report.undocumentedExports).toEqual(['NewService', 'helperFunc']);
    });

    it('reports no drift when declared exports match AST exactly', () => {
      const declaredExports = ['MyClass', 'myFunc'];
      const sourceCode = `
export class MyClass {}
export function myFunc() {}
`;

      const report = checkInterfaceDrift(declaredExports, sourceCode, 'module.ts');

      expect(report.hasDrift).toBe(false);
      expect(report.missingInCode).toEqual([]);
      expect(report.undocumentedExports).toEqual([]);
    });
  });
});
