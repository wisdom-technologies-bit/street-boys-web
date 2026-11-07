import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/config/env';
import { consoleProvider } from './console';

beforeEach(() => {
  vi.stubEnv('EMAIL_PROVIDER', 'console');
  vi.stubEnv('NODE_ENV', 'development');
  resetEnvCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('ConsoleProvider', () => {
  it('logs the code instead of sending it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await consoleProvider.sendOtp({
      to: 'player@example.com',
      code: '123456',
      expiresInMinutes: 10,
    });

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain('123456');
    expect(line).toContain('player@example.com');
    expect(line).toContain('10 minutes');
  });

  it('refuses to run in production, where a log is not an inbox', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    resetEnvCache();

    await expect(
      consoleProvider.sendOtp({ to: 'player@example.com', code: '123456', expiresInMinutes: 10 }),
    ).rejects.toThrow(/production/);
  });
});
