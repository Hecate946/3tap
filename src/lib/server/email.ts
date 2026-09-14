import { env } from '$env/dynamic/private';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = '3tap <reset@3tap.cc>';

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

  const from = env.RESET_EMAIL_FROM?.trim() || DEFAULT_FROM;
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'reset your 3tap password',
      text: `Reset your 3tap password:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
      html: `<p>Reset your 3tap password:</p><p><a href="${resetUrl}">reset password</a></p><p>This link expires in 30 minutes. If you did not request it, ignore this email.</p>`
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}
