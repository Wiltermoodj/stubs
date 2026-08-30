import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface TypeCheckResult {
  success: boolean;
  diagnostics: string[];
}

interface CachedConfig {
  mtimeMs: number;
  compilerOptions: ts.CompilerOptions;
  fileNames: string[];
}

const configCache = new Map<string, CachedConfig>();

function getParsedConfig(resolvedTsconfigPath: string): {
  compilerOptions: ts.CompilerOptions;
  fileNames: string[];
  error?: string;
} {
  try {
    if (!fs.existsSync(resolvedTsconfigPath)) {
      return {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        fileNames: [],
      };
    }

    const stat = fs.statSync(resolvedTsconfigPath);
    const cached = configCache.get(resolvedTsconfigPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return {
        compilerOptions: { ...cached.compilerOptions },
        fileNames: [...cached.fileNames],
      };
    }

    const readResult = ts.readConfigFile(resolvedTsconfigPath, ts.sys.readFile);
    if (readResult.error) {
      return {
        compilerOptions: {},
        fileNames: [],
        error: `Failed to parse tsconfig.json: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')}`,
      };
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      path.dirname(resolvedTsconfigPath),
    );

    const compilerOptions = { ...parsedConfig.options };
    delete compilerOptions.rootDir;
    delete compilerOptions.rootDirs;

    configCache.set(resolvedTsconfigPath, {
      mtimeMs: stat.mtimeMs,
      compilerOptions,
      fileNames: parsedConfig.fileNames,
    });

    return {
      compilerOptions: { ...compilerOptions },
      fileNames: [...parsedConfig.fileNames],
    };
  } catch {
    return {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      fileNames: [],
    };
  }
}

let lastProgram: ts.Program | null = null;

/**
 * Executes an in-memory TypeScript compilation and type-check on a virtual overlay file.
 * Automatically loads tsconfig.json options and physical workspace files, avoiding false-negatives.
 */
export function typeCheckVirtualFile(
  targetFilePath: string,
  virtualContent: string,
  tsconfigPath?: string,
): TypeCheckResult {
  const absoluteTargetFilePath = path.resolve(targetFilePath);
  const resolvedTsconfigPath = tsconfigPath || path.resolve(process.cwd(), 'tsconfig.json');

  const configResult = getParsedConfig(resolvedTsconfigPath);
  if (configResult.error) {
    return {
      success: false,
      diagnostics: [configResult.error],
    };
  }

  const compilerOptions = configResult.compilerOptions;
  const fileNames = configResult.fileNames;

  // Force noEmit to prevent actual file writes during compilation check
  compilerOptions.noEmit = true;

  // Create the default compiler host
  const host = ts.createCompilerHost(compilerOptions);

  // Override readFile to return the virtual content for the target file
  const originalReadFile = host.readFile;
  host.readFile = (fileName: string) => {
    const resolvedPath = path.resolve(fileName);
    if (resolvedPath === absoluteTargetFilePath) {
      return virtualContent;
    }
    return originalReadFile.call(host, fileName);
  };

  // Override fileExists to report our virtual file is present
  const originalFileExists = host.fileExists;
  host.fileExists = (fileName: string) => {
    const resolvedPath = path.resolve(fileName);
    if (resolvedPath === absoluteTargetFilePath) {
      return true;
    }
    return originalFileExists.call(host, fileName);
  };

  // Override getSourceFile to create the in-memory source file
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (
    fileName: string,
    languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
    onError?: (message: string) => void,
    shouldCreateNewSourceFile?: boolean,
  ) => {
    const resolvedPath = path.resolve(fileName);
    if (resolvedPath === absoluteTargetFilePath) {
      return ts.createSourceFile(
        fileName,
        virtualContent,
        compilerOptions.target || ts.ScriptTarget.ES2022,
      );
    }
    return originalGetSourceFile.call(
      host,
      fileName,
      languageVersionOrOptions,
      onError,
      shouldCreateNewSourceFile,
    );
  };

  // Ensure target code file is treated as a root of compilation
  const rootNames = Array.from(new Set([...fileNames, absoluteTargetFilePath]));

  try {
    const program = ts.createProgram(rootNames, compilerOptions, host, lastProgram || undefined);
    lastProgram = program;
    const diagnostics = ts.getPreEmitDiagnostics(program);

    if (diagnostics.length > 0) {
      const formattedDiagnostics = diagnostics.map((diag) => {
        if (diag.file) {
          const { line, character } = ts.getLineAndCharacterOfPosition(diag.file, diag.start!);
          const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
          return `${diag.file.fileName} (${line + 1},${character + 1}): ${message}`;
        } else {
          return ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        }
      });
      return {
        success: false,
        diagnostics: formattedDiagnostics,
      };
    }

    return {
      success: true,
      diagnostics: [],
    };
  } catch (error: any) {
    return {
      success: false,
      diagnostics: [`Compilation crashed: ${error.message || error}`],
    };
  }
}
