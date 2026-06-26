import { emailTransporter } from "@/lib/auth";

const APP_NAME = "YatraAI";

interface SosDispatchInput {
  alertId: string;
  userName: string;
  message: string;
  locationStr: string;
  shareLink: string | null;
  healthInfo: {
    bloodType: string | null;
    allergies: string[];
    conditions: string[];
  } | null;
}

interface Contact {
  name: string;
  phone: string;
  email: string | null;
}

function buildSosEmailHtml(input: SosDispatchInput, contactName: string): string {
  const shareSection = input.shareLink
    ? `<p style="margin:0 0 16px;">
        <a href="${input.shareLink}" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
          View Live Location
        </a>
       </p>`
    : "";

  const healthSection = input.healthInfo
    ? `<table cellpadding="4" style="background:#f8fafc;border-radius:8px;margin:12px 0;font-size:13px;color:#1e293b;">
         ${input.healthInfo.bloodType ? `<tr><td style="padding:4px 12px;color:#64748b;">Blood type</td><td style="padding:4px 12px;font-weight:600;">${input.healthInfo.bloodType}</td></tr>` : ""}
         ${input.healthInfo.allergies.length ? `<tr><td style="padding:4px 12px;color:#64748b;">Allergies</td><td style="padding:4px 12px;font-weight:600;">${input.healthInfo.allergies.join(", ")}</td></tr>` : ""}
         ${input.healthInfo.conditions.length ? `<tr><td style="padding:4px 12px;color:#64748b;">Conditions</td><td style="padding:4px 12px;font-weight:600;">${input.healthInfo.conditions.join(", ")}</td></tr>` : ""}
       </table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #f59e0b;border-radius:16px;">
        <tr>
          <td style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:28px;text-align:center;border-radius:16px 16px 0 0;">
            <span style="font-size:32px;">🆘</span>
            <h1 style="margin:8px 0 0;font-size:20px;color:#fff;">SOS: ${input.userName} needs help!</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;"><strong>${contactName}</strong>, <strong>${input.userName}</strong> has triggered an emergency alert on ${APP_NAME}.</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 16px;">
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Message</p>
              <p style="margin:0;font-size:15px;color:#1e293b;">${input.message}</p>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 16px;">
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Location</p>
              <p style="margin:0;font-size:13px;color:#2563eb;">${input.locationStr}</p>
            </div>
            ${shareSection}
            ${healthSection}
            <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">This is an automated alert from ${APP_NAME}. Please respond immediately.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── General notification email dispatch ──────────────────────────────────────

interface GeneralNotificationInput {
  id: string;
  userId: string;
  message: string;
  createdAt: Date;
}

function typeFromMessage(msg: string): string {
  try {
    const data = JSON.parse(msg);
    return data._type ?? "GENERAL";
  } catch {
    return "GENERAL";
  }
}

function buildGeneralEmailHtml(
  userName: string,
  notificationType: string,
  title: string,
  body: string,
): string {
  const emojiMap: Record<string, string> = {
    HAZARD: "⚠️",
    SOS: "🆘",
    FRIEND_REQUEST: "👤",
    TRIP_INVITE: "✈️",
    ALERT: "🔔",
    GENERAL: "📬",
  };
  const emoji = emojiMap[notificationType] ?? "📬";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
        <tr>
          <td style="background:linear-gradient(135deg,#1e293b,#334155);padding:24px;text-align:center;border-radius:16px 16px 0 0;">
            <span style="font-size:28px;">${emoji}</span>
            <h1 style="margin:8px 0 0;font-size:18px;color:#fff;">${title}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">Hi <strong>${userName}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">${body}</p>
            <p style="margin:0;font-size:12px;color:#94a3b8;">This is an automated notification from ${APP_NAME}.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface NotificationEmailRecipient {
  email: string;
  name: string;
}

/**
 * Dispatch an email for a single notification.
 * Parses the JSON message to extract type/title/body.
 * Falls back silently if the transport is unavailable.
 */
export async function dispatchNotificationEmail(
  recipient: NotificationEmailRecipient,
  notification: { message: string },
): Promise<void> {
  if (!emailTransporter) return;
  if (!recipient.email) return;

  const ntype = typeFromMessage(notification.message);

  let title: string;
  let body: string;
  try {
    const data = JSON.parse(notification.message);
    title = data.title ?? `${APP_NAME} Notification`;
    body  = data.body  ?? "You have a new notification.";
  } catch {
    title = `${APP_NAME} Notification`;
    body  = notification.message;
  }

  await emailTransporter.sendMail({
    from: `${APP_NAME} <${process.env.GMAIL_USER ?? "noreply@yatraai.com"}>`,
    to: recipient.email,
    subject: `${title} — ${APP_NAME}`,
    html: buildGeneralEmailHtml(recipient.name, ntype, title, body),
  });
}

// ── SOS dispatch ──────────────────────────────────────────────────────────────

// ── SMS dispatch (SparrowSMS — Nepal-compatible) ─────────────────────────────

interface SmsProvider {
  send(phone: string, message: string): Promise<boolean>;
}

const smsProvider: SmsProvider | null = getSmsProvider();

function getSmsProvider(): SmsProvider | null {
  const token = process.env.SPARROW_SMS_TOKEN;
  const from  = process.env.SPARROW_SMS_FROM;
  if (!token || !from) return null;

  return {
    async send(phone: string, message: string): Promise<boolean> {
      try {
        const url = `https://api.sparrowsms.com/v2/sms/`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            from,
            to: phone,
            text: message,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Send an SMS alert to a single emergency contact.
 * Returns true if the message was accepted by the gateway.
 */
export async function dispatchSosSms(contactName: string, phone: string, userName: string, message: string, locationStr: string): Promise<boolean> {
  if (!smsProvider) {
    console.warn("[dispatch] No SMS provider configured — set SPARROW_SMS_TOKEN and SPARROW_SMS_FROM");
    return false;
  }

  const text = `SOS: ${userName} needs help! "${message}" Location: ${locationStr}`;
  return smsProvider.send(phone, text);
}

export async function dispatchSosNotifications(
  input: SosDispatchInput,
  contacts: Contact[],
): Promise<{ emailed: number }> {
  let emailed = 0;

  for (const contact of contacts) {
    if (contact.email && emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: `${APP_NAME} <${process.env.GMAIL_USER ?? "noreply@yatraai.com"}>`,
          to: contact.email,
          subject: `🆘 SOS: ${input.userName} needs help!`,
          html: buildSosEmailHtml(input, contact.name),
        });
        emailed++;
      } catch (err) {
        console.warn("[dispatch] Failed to email", contact.email, err);
      }
    }
  }

  return { emailed };
}
