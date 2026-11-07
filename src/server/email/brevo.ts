import { getEnv } from '@/server/config/env';
import { OTP_SUBJECT, otpHtml, otpText } from './content';
import { EmailSendError, type EmailProvider, type SendOtpInput } from './types';

/**
 * Brevo's transactional email API.
 *
 * Checked against Brevo's API reference (`POST https://api.brevo.com/v3/smtp/email`):
 * authentication is the `api-key` header, the body carries `sender`, `to`,
 * `subject`, `htmlContent` and `textContent`, and a success is `201` with a
 * `messageId`. No SDK: one `fetch` call is the whole integration, which is one
 * less dependency and one less package to keep patched.
 *
 * Failure policy: a network error, a timeout or a 5xx is retried **once**, because
 * a retry after a blip usually works. A 4xx is not retried, because the same
 * request will be refused again and a second attempt only burns quota.
 */

export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10_000;

type BrevoConfig = {
  apiKey: string;
  fromAddress: string;
  fromName: string;
};

function config(): BrevoConfig {
  const env = getEnv();
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM_ADDRESS || !env.EMAIL_FROM_NAME) {
    // The environment rules already refuse this combination; this is the second
    // lock on the same door, for the case where something bypassed them.
    throw new Error('brevoProvider: missing configuration');
  }
  return {
    apiKey: env.BREVO_API_KEY,
    fromAddress: env.EMAIL_FROM_ADDRESS,
    fromName: env.EMAIL_FROM_NAME,
  };
}

async function postOnce(
  fetchImpl: typeof fetch,
  settings: BrevoConfig,
  input: SendOtpInput,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetchImpl(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': settings.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: settings.fromAddress, name: settings.fromName },
        to: [{ email: input.to }],
        subject: OTP_SUBJECT,
        textContent: otpText(input.code, input.expiresInMinutes),
        htmlContent: otpHtml(input.code, input.expiresInMinutes),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createBrevoProvider(fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: 'brevo',

    async sendOtp(input: SendOtpInput): Promise<void> {
      const settings = config();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: Response;

        try {
          response = await postOnce(fetchImpl, settings, input);
        } catch {
          // Network error or abort. The message is deliberately not passed on:
          // it can contain the URL, and an error without detail cannot leak a key.
          if (attempt === 0) continue;
          throw new EmailSendError();
        }

        if (response.ok) return;

        const status = response.status;
        if (status >= 400 && status < 500) {
          throw new EmailSendError(status);
        }
        if (attempt === 0) continue;
        throw new EmailSendError(status);
      }
    },
  };
}
