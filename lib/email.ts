import { emailTransporter } from "./auth";

const APP_NAME = "YatraAI";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const FROM_EMAIL = process.env.GMAIL_USER ?? "noreply@yatraai.com";

const FOOTER = `
  <tr>
    <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <p style="margin:0;font-size:11px;color:#334155;">
        © 2026 ${APP_NAME} · AI Travel Safety for Nepal
      </p>
    </td>
  </tr>`;

function wrapper(heading: string, bodyHtml: string) {
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
            ${bodyHtml}
          </td>
        </tr>
        ${FOOTER}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function tripLinkButton(planId: string, label: string) {
  const url = `${BASE_URL}/trips/${planId}`;
  return `<a href="${url}" target="_blank"
    style="display:inline-block;padding:14px 32px;margin:16px 0;background:#f59e0b;color:#0a0f1e;
    font-weight:700;border-radius:10px;text-decoration:none;font-family:'DM Sans',Arial,sans-serif;font-size:14px;">
    ${label}
  </a>`;
}

function tripInfoLines(trip: { title: string; startDate: Date; endDate: Date; stops?: number }) {
  return `
    <p style="margin:0 0 8px;font-size:14px;color:#e2e8f0;font-weight:600;">${trip.title}</p>
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">
      📅 ${trip.startDate.toLocaleDateString()} → ${trip.endDate.toLocaleDateString()}
    </p>
    ${trip.stops ? `<p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">📍 ${trip.stops} stop${trip.stops !== 1 ? "s" : ""}</p>` : ""}`;
}

type EmailType = "reminder-3d" | "reminder-1d" | "trip-start" | "trip-end" | "date-changed" | "trip-extended";

const templates: Record<EmailType, (trip: { id: string; title: string; startDate: Date; endDate: Date; stops?: number }, userName: string) => { subject: string; html: string }> = {
  "reminder-3d": (trip, userName) => ({
    subject: `⏰ 3 days until "${trip.title}" — start preparing!`,
    html: wrapper(
      `⏰ 3 days to go!`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#cbd5e1;">Your trip is just 3 days away! Time to pack your bags and get ready for an adventure.</p>
      ${tripInfoLines(trip)}
      <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#94a3b8;">
        🎒 Check your packing list<br/>
        🏠 Confirm your accommodations<br/>
        🚗 Review your route
      </p>
      ${tripLinkButton(trip.id, "View Trip Details")}
      <p style="margin:0;font-size:12px;color:#64748b;">— ${APP_NAME} Team</p>`,
    ),
  }),

  "reminder-1d": (trip, userName) => ({
    subject: `🚀 "${trip.title}" starts TOMORROW!`,
    html: wrapper(
      `🚀 Starts tomorrow!`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#cbd5e1;">Big day tomorrow! Your trip to <strong>${trip.title}</strong> begins.</p>
      ${tripInfoLines(trip)}
      <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#94a3b8;">
        ✅ Documents ready?<br/>
        📱 Share your live location with friends<br/>
        🌤️ Check the weather along your route
      </p>
      ${tripLinkButton(trip.id, "View Trip Details")}
      <p style="margin:0;font-size:12px;color:#64748b;">Safe travels! — ${APP_NAME} Team</p>`,
    ),
  }),

  "trip-start": (trip, userName) => ({
    subject: `🎒 "${trip.title}" starts today!`,
    html: wrapper(
      `🎒 Time to start "${trip.title}"?`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#cbd5e1;">Your trip starts today! Did you begin your journey?</p>
      ${tripInfoLines(trip)}
      ${tripLinkButton(trip.id, "View Trip Details")}
      <p style="margin:0;font-size:12px;color:#64748b;">⏱️ Remember to mark your trip as started when you depart.</p>
      <p style="margin:0;font-size:12px;color:#64748b;">— ${APP_NAME} Team</p>`,
    ),
  }),

  "trip-end": (trip, userName) => ({
    subject: `✅ Did "${trip.title}" end?`,
    html: wrapper(
      `✅ Trip complete?`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#cbd5e1;">Your trip should be over now. Did you finish, or do you need to extend?</p>
      ${tripInfoLines(trip)}
      ${tripLinkButton(trip.id, "View Trip Details")}
      <p style="margin:0;font-size:12px;color:#64748b;">⏱️ You can mark your trip as complete or extend it from the trip page.</p>
      <p style="margin:0;font-size:12px;color:#64748b;">— ${APP_NAME} Team</p>`,
    ),
  }),

  "date-changed": (trip, userName) => ({
    subject: `📅 "${trip.title}" has been rescheduled`,
    html: wrapper(
      `📅 Trip dates updated`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#cbd5e1;">Your trip dates have been updated.</p>
      ${tripInfoLines(trip)}
      ${tripLinkButton(trip.id, "View Updated Trip")}
      <p style="margin:0;font-size:12px;color:#64748b;">— ${APP_NAME} Team</p>`,
    ),
  }),

  "trip-extended": (trip, userName) => ({
    subject: `⏱ "${trip.title}" has been extended!`,
    html: wrapper(
      `⏱ Trip extended!`,
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#94a3b8;">Hi ${userName},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#cbd5e1;">Great news — your trip has been extended! More time to explore.</p>
      ${tripInfoLines(trip)}
      ${tripLinkButton(trip.id, "View Updated Trip")}
      <p style="margin:0;font-size:12px;color:#64748b;">— ${APP_NAME} Team</p>`,
    ),
  }),
};

export async function sendTripEmail(
  user: { name: string; email: string },
  trip: { id: string; title: string; startDate: Date; endDate: Date; stops?: number },
  type: EmailType,
) {
  if (!emailTransporter || !user.email) return;
  const tpl = templates[type](trip, user.name);
  await emailTransporter.sendMail({
    from: `${APP_NAME} <${FROM_EMAIL}>`,
    to: user.email,
    subject: tpl.subject,
    html: tpl.html,
  }).catch(() => {});
}
