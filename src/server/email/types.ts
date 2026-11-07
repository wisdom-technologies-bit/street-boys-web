/**
 * The email port.
 *
 * The app knows this interface and nothing else about email. Swapping Brevo for
 * another provider is one file, and no route, service or test changes.
 */
export type SendOtpInput = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

export type EmailProvider = {
  readonly name: 'brevo' | 'console';
  sendOtp(input: SendOtpInput): Promise<void>;
};

/** Thrown when a provider cannot deliver. Never carries the code or the address. */
export class EmailSendError extends Error {
  constructor(readonly status?: number) {
    super(
      status
        ? `The email provider refused the message (status ${status}).`
        : 'The email provider could not be reached.',
    );
    this.name = 'EmailSendError';
  }
}
