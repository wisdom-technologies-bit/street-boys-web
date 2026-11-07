import { getEnv } from '@/server/config/env';
import { OTP_SUBJECT } from './content';
import type { EmailProvider, SendOtpInput } from './types';

/**
 * Prints the code to the server log instead of sending it.
 *
 * Development only, and refused in production by the environment rules, because
 * a code in a log is a code anyone with log access can use. It exists so a
 * developer can sign in on a laptop without an email account.
 */
export const consoleProvider: EmailProvider = {
  name: 'console',

  async sendOtp({ to, code, expiresInMinutes }: SendOtpInput): Promise<void> {
    if (getEnv().NODE_ENV === 'production') {
      throw new Error('consoleProvider: refusing to print an OTP code in production');
    }

    // The code is printed here and nowhere else in the application.
    console.info(
      `[dev email] ${OTP_SUBJECT} -> ${to}: ${code} (expires in ${expiresInMinutes} minutes)`,
    );
  },
};
