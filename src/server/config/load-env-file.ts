import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load a developer's `.env` file, and only a developer's.
 *
 * The pre-deploy migration is the one place in this repository that ran under a
 * package it could not have in production: it imported `dotenv`, which is a
 * `devDependency`, so it died with `ERR_MODULE_NOT_FOUND` in an image built with
 * `npm ci --omit=dev`. Node has had `process.loadEnvFile` since **20.12**, and
 * `.nvmrc`, `engines` and the Dockerfile all pin Node 24, so the dependency was
 * never needed. The rule that replaces it:
 *
 * 1. **In production, never touch a file.** Variables come from the environment,
 *    which is what a platform dashboard provides. A stray `.env` left in an image
 *    must not be able to override it.
 * 2. **Locally, a missing file is normal.** Every repository has `.env.example`
 *    and few developers have `.env`; a migration that refuses to run because a
 *    file is absent is a migration nobody runs.
 * 3. **Anything else is a real error.** A file that exists but cannot be parsed
 *    is a mistake worth a stack trace, so only `ENOENT` is swallowed.
 */

/** Checked in order: the developer's overrides first, then the shared defaults. */
export const LOCAL_ENV_FILES = ['.env.local', '.env'] as const;

export type LoadEnvFileOptions = {
  /** Defaults to `process.env.NODE_ENV`. */
  nodeEnv?: string;
  /** Defaults to `process.cwd()`. */
  cwd?: string;
  /** Defaults to {@link LOCAL_ENV_FILES}; tests pass their own. */
  files?: readonly string[];
};

/**
 * The file that was loaded, or `null` when none was. Never throws for a missing
 * file, and never logs a value.
 */
export function loadLocalEnvFile(options: LoadEnvFileOptions = {}): string | null {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') return null;

  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? LOCAL_ENV_FILES;

  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;

    try {
      process.loadEnvFile(path);
      return path;
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
  }

  return null;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
