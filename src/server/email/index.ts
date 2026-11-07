import { getEnv } from '@/server/config/env';
import { createBrevoProvider } from './brevo';
import { consoleProvider } from './console';
import type { EmailProvider } from './types';

export { EmailSendError } from './types';
export type { EmailProvider, SendOtpInput } from './types';

/** The provider the environment names. Brevo in production, console locally. */
export function getEmailProvider(): EmailProvider {
  return getEnv().EMAIL_PROVIDER === 'brevo' ? createBrevoProvider() : consoleProvider;
}
