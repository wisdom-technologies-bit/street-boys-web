import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ENV_FILES, loadLocalEnvFile } from './load-env-file';

/**
 * The rule that replaced `dotenv`: production never reads a file, development
 * tolerates a missing one, and nothing crashes for a file that is simply absent.
 */

let dir: string;
const KEYS = ['SB_TEST_ENV_DEFAULT', 'SB_TEST_ENV_LOCAL', 'SB_TEST_ENV_PRODUCTION'] as const;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-env-'));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const key of KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

describe('Node supports process.loadEnvFile', () => {
  it('is available in this runtime, which is why dotenv is gone', () => {
    // Node 20.12 introduced it; .nvmrc, engines and the Dockerfile all pin 24.
    expect(typeof process.loadEnvFile).toBe('function');
  });
});

describe('loadLocalEnvFile', () => {
  it('never reads a file in production, even when one is sitting there', () => {
    writeFileSync(join(dir, '.env'), 'SB_TEST_ENV_PRODUCTION=leaked\n');

    const loaded = loadLocalEnvFile({ nodeEnv: 'production', cwd: dir });

    expect(loaded).toBeNull();
    expect(process.env.SB_TEST_ENV_PRODUCTION).toBeUndefined();
  });

  it('treats a missing file as normal in development', () => {
    expect(() => loadLocalEnvFile({ nodeEnv: 'development', cwd: dir })).not.toThrow();
    expect(loadLocalEnvFile({ nodeEnv: 'development', cwd: dir })).toBeNull();
  });

  it('tolerates a missing file in a directory that does not exist', () => {
    expect(loadLocalEnvFile({ nodeEnv: 'test', cwd: join(dir, 'nope') })).toBeNull();
  });

  it('loads .env in development', () => {
    writeFileSync(join(dir, '.env'), 'SB_TEST_ENV_DEFAULT=from-dot-env\n');

    const loaded = loadLocalEnvFile({ nodeEnv: 'development', cwd: dir });

    expect(loaded).toBe(join(dir, '.env'));
    expect(process.env.SB_TEST_ENV_DEFAULT).toBe('from-dot-env');
  });

  it('prefers .env.local over .env', () => {
    writeFileSync(join(dir, '.env'), 'SB_TEST_ENV_DEFAULT=shared\n');
    writeFileSync(join(dir, '.env.local'), 'SB_TEST_ENV_LOCAL=mine\n');

    const loaded = loadLocalEnvFile({ nodeEnv: 'development', cwd: dir });

    expect(loaded).toBe(join(dir, '.env.local'));
    expect(process.env.SB_TEST_ENV_LOCAL).toBe('mine');
  });

  it('reads the real environment when NODE_ENV says production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    writeFileSync(join(dir, '.env'), 'SB_TEST_ENV_PRODUCTION=leaked\n');

    expect(loadLocalEnvFile({ cwd: dir })).toBeNull();
    expect(process.env.SB_TEST_ENV_PRODUCTION).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('swallows a missing file but rethrows any other read error', () => {
    writeFileSync(join(dir, '.env'), 'SB_TEST_ENV_DEFAULT=present\n');

    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });

    // A file removed between the check and the read is not an error worth stopping for.
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      throw missing;
    });
    expect(loadLocalEnvFile({ nodeEnv: 'development', cwd: dir })).toBeNull();

    // A file that exists but cannot be read is a real problem, and stays one.
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      throw denied;
    });
    expect(() => loadLocalEnvFile({ nodeEnv: 'development', cwd: dir })).toThrow(/denied/);
  });

  it('checks .env.local first, then .env', () => {
    expect(LOCAL_ENV_FILES).toEqual(['.env.local', '.env']);
  });
});
