/**
 * What the email says.
 *
 * Short, plain, and identical in both parts: a player reading it on a cheap
 * Android phone in a hurry needs the six digits and the two facts that matter.
 * There is no tracking pixel, no remote image, and no link, so nothing in the
 * message can leak that it was opened.
 */
export const OTP_SUBJECT = 'Your Street Boys code';

export function otpText(code: string, expiresInMinutes: number): string {
  return [
    `Your Street Boys code is ${code}`,
    '',
    `It expires in ${expiresInMinutes} minutes.`,
    'If you did not ask for this code, ignore this email: nothing happens without it.',
    '',
    'Street Boys',
  ].join('\n');
}

export function otpHtml(code: string, expiresInMinutes: number): string {
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    '<p>Your Street Boys code is</p>',
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>`,
    `<p>It expires in ${expiresInMinutes} minutes.</p>`,
    '<p>If you did not ask for this code, ignore this email: nothing happens without it.</p>',
    '<p>Street Boys</p>',
    '</body></html>',
  ].join('');
}
