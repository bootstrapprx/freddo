import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "@/db";
import { account, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema";

const DEV_SECRET = "freddo-dev-only-secret-change-me";

async function sendEmail({ to, subject, text }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    // Local/demo fallback: without an email provider there is no other way to
    // reach a reset link. Never rely on this in production.
    console.warn(`[freddo] email provider not configured; ${subject}\n${text}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao enviar e-mail (${response.status})`);
  }
}

export const auth = betterAuth({
  appName: "freddo",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET || DEV_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: { user, session, account, verification, twoFactor: twoFactorTable },
  }),
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user" },
    },
  },
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user: recipient, url }) => {
      await sendEmail({
        to: recipient.email,
        subject: "Redefina sua senha no freddo",
        text: `Use o link abaixo para redefinir sua senha:\n${url}\n\nSe não foi você, ignore este e-mail.`,
      });
    },
  },
  plugins: [twoFactor({ issuer: "freddo" }), tanstackStartCookies()],
});
