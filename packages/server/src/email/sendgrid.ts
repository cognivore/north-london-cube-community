/**
 * SendGrid email sender for magic links.
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@cube.london";
const FROM_NAME = process.env.FROM_NAME ?? "North London Cube Community";
const APP_URL = process.env.APP_URL ?? "https://north.cube.london";
const TEST_MODE = process.env.TEST_MODE === "true";
const TEST_REDIRECT_EMAIL = "jm@memorici.de";

export async function sendMagicLinkEmail(
  to: string,
  token: string,
  userId: string,
): Promise<void> {
  const magicLink = `${APP_URL}/auth/verify?userId=${userId}&token=${token}`;
  const actualTo = TEST_MODE ? TEST_REDIRECT_EMAIL : to;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: actualTo }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: "Sign in to North London Cube Community",
      content: [
        {
          type: "text/plain",
          value: `Click this link to sign in:\n\n${magicLink}\n\nThis link expires in 30 minutes.\n\nIf you didn't request this, ignore this email.`,
        },
        {
          type: "text/html",
          value: `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #e5e5e5; background: #0a0a0a;">
  <h1 style="color: #f59e0b; font-size: 24px; margin-bottom: 8px;">North London Cube Community</h1>
  <p style="color: #a3a3a3; margin-bottom: 32px;">Friday night MTG cube drafts at Hitchhiker & Owl</p>

  <p style="margin-bottom: 24px;">Click below to sign in:</p>

  <a href="${magicLink}" style="display: inline-block; background: #f59e0b; color: #0a0a0a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">
    Sign in
  </a>

  <p style="color: #737373; font-size: 13px; margin-top: 32px;">
    This link expires in 30 minutes. If you didn't request this, ignore this email.
  </p>

  <p style="color: #525252; font-size: 12px; margin-top: 40px; border-top: 1px solid #262626; padding-top: 16px;">
    Hitchhiker & Owl, Palmers Green N13 &middot; Doors 18:30 &middot; P1P1 18:45
  </p>
</body>
</html>`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
}
