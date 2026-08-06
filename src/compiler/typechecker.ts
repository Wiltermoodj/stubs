import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface TypeCheckResult {
  success: boolean;
  diagnostics: string[];
}

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

  let compilerOptions: ts.CompilerOptions = {};
  let fileNames: string[] = [];

  if (fs.existsSync(resolvedTsconfigPath)) {
    const readResult = ts.readConfigFile(resolvedTsconfigPath, ts.sys.readFile);
    if (readResult.error) {
      return {
        success: false,
        diagnostics: [
          `Failed to parse tsconfig.json: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')}`,
        ],
      };
    }
    const parsedConfig = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      path.dirname(resolvedTsconfigPath),
    );
    compilerOptions = parsedConfig.options;
    fileNames = parsedConfig.fileNames;
    delete compilerOptions.rootDir;
    delete compilerOptions.rootDirs;
  } else {
    // Default fallback options if no tsconfig.json is found
    compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    };
  }

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
    const program = ts.createProgram(rootNames, compilerOptions, host);
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
