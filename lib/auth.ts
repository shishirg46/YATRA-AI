import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, username } from "better-auth/plugins";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import nodemailer from "nodemailer";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

// Gmail transporter — works instantly without a verified domain
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // Google App Password, not your real password
  },
});

const APP_NAME   = "YatraAI";
const FROM_EMAIL = process.env.GMAIL_USER ?? "noreply@yatraai.com";

export const emailTransporter = transporter;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ],

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600, // 10 minutes

      async sendVerificationOTP({ email, otp, type }) {
        // ── DEV: log OTP to terminal so you don't need email working locally
        if (process.env.NODE_ENV === "development") {
          console.log(`\n🔑 OTP for ${email} [${type}]: ${otp}\n`);
        }
        const config = {
          "email-verification": {
            subject: `Verify your ${APP_NAME} account`,
            heading: "Verify your email",
            body: "Use the code below to verify your email address. It expires in 10 minutes.",
          },
          "sign-in": {
            subject: `Your ${APP_NAME} sign-in code`,
            heading: "Sign-in code",
            body: "Use the code below to sign in to your account. It expires in 10 minutes.",
          },
          "forget-password": {
            subject: `Reset your ${APP_NAME} password`,
            heading: "Reset your password",
            body: "Use the code below to reset your password. It expires in 10 minutes.",
          },
          "change-email": {
            subject: `Confirm your new ${APP_NAME} email`,
            heading: "Confirm email change",
            body: "Use the code below to confirm your new email address. It expires in 10 minutes.",
          },
        }[type] ?? {
          subject: `Your ${APP_NAME} code`,
          heading: "Your code",
          body: "Use the code below. It expires in 10 minutes.",
        };

        await transporter.sendMail({
          from: `${APP_NAME} <${FROM_EMAIL}>`,
          to: email,
          subject: config.subject,
          html: buildOtpEmail({ heading: config.heading, body: config.body, otp }),
        });
      },
    }),
    username(),
  ],
});

/////////////////////////////////////////////////
// OTP email template
/////////////////////////////////////////////////

function buildOtpEmail({
  heading,
  body,
  otp,
}: {
  heading: string;
  body: string;
  otp: string;
}) {
  const digitBoxes = otp
    .split("")
    .map(
      (d) => `<td style="padding:0 4px;">
        <div style="width:48px;height:60px;background:#1a2035;border:2px solid rgba(245,158,11,0.45);
          border-radius:10px;font-size:28px;font-weight:700;color:#f59e0b;
          text-align:center;line-height:60px;font-family:Georgia,serif;">
          ${d}
        </div>
      </td>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:48px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
        style="background:#0f1729;border:1px solid rgba(245,158,11,0.2);border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#1a2035,#0f1729);padding:28px 40px;
            text-align:center;border-bottom:1px solid rgba(245,158,11,0.12);">
            <span style="font-size:20px;font-weight:700;color:#fff;">🏔️ ${APP_NAME}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;text-align:center;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#fff;">${heading}</h1>
            <p style="margin:0 0 36px;font-size:14px;line-height:1.7;color:#94a3b8;">${body}</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 36px;">
              <tr>${digitBoxes}</tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#64748b;">
              Expires in <strong style="color:#f59e0b;">10 minutes</strong>.
            </p>
            <p style="margin:0;font-size:12px;color:#475569;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="margin:0;font-size:11px;color:#334155;">
              © 2026 ${APP_NAME} · AI Travel Safety for Nepal
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
