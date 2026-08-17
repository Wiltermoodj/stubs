import * as path from 'path';

/**
 * Resolves a relative path against a base directory, ensuring the result
 * is contained within the base directory (fail-closed path containment).
 *
 * This is the single source of truth for resolving `target_code_file`
 * from untrusted sidecar frontmatter into a safe absolute path.
 *
 * @param baseDir - The base directory that must contain the result
 * @param relativePath - The untrusted relative path from frontmatter
 * @returns The resolved absolute path, guaranteed to be within baseDir
 * @throws If the resolved path would escape the base directory
 */
export function resolveContainedPath(baseDir: string, relativePath: string): string {
  const absoluteBase = path.resolve(baseDir);
  const absoluteTarget = path.resolve(absoluteBase, relativePath);

  // Normalize both paths for comparison (handle symlinks, case sensitivity, etc.)
  const normalizedBase = path.resolve(absoluteBase);
  const normalizedTarget = path.resolve(absoluteTarget);

  // Check containment: the target must start with the base directory path
  // We use startsWith with a path separator check to prevent directory traversal
  const relativeFromBase = path.relative(normalizedBase, normalizedTarget);
  const isContained = !relativeFromBase.startsWith('..') && !path.isAbsolute(relativeFromBase);

  if (!isContained) {
    throw new Error(
      `Path containment violation: "${relativePath}" resolves outside of base directory "${absoluteBase}"`,
    );
  }

  return normalizedTarget;
}

/**
 * Validates that a path is safe (no directory traversal, absolute paths, etc.)
 * without resolving it against a base directory.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    return false;
  }

  // Reject paths that start with ..
  if (
    relativePath.startsWith('..') ||
    relativePath.includes('/../') ||
    relativePath.includes('\\..\\')
  ) {
    return false;
  }

  // Reject paths that attempt to traverse up via path normalization
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return false;
  }

  return true;
}

/**
 * Validates a target_code_file value from sidecar frontmatter.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateTargetCodeFile(targetCodeFile: string): string | null {
  if (!targetCodeFile || typeof targetCodeFile !== 'string') {
    return 'target_code_file is required and must be a non-empty string';
  }

  if (!isSafeRelativePath(targetCodeFile)) {
    return 'target_code_file contains invalid path traversal (.. or absolute path)';
  }

  // Ensure it ends with .ts (our convention for target code files)
  if (!targetCodeFile.endsWith('.ts')) {
    return 'target_code_file must end with .ts extension';
  }

  return null;
}
