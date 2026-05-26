/**
 * SMTP email delivery for scheduled exports.
 *
 * Uses nodemailer under the hood. Activated by the presence of
 * SMTP_HOST env var. When missing, the sendEmail function throws so
 * the schedule runner catches it and records the failure.
 *
 * Configuration:
 *   SMTP_HOST     required
 *   SMTP_PORT     default 587
 *   SMTP_USER     optional (no auth if unset)
 *   SMTP_PASS     optional
 *   SMTP_FROM     default "reports@localhost"
 *   SMTP_SECURE   "true" for TLS on connect; default false (STARTTLS)
 */

import { createTransport, type Transporter } from "nodemailer";

let _transport: Transporter | null = null;

function getTransport(): Transporter {
  if (_transport) return _transport;
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST not configured");
  _transport = createTransport({
    host,
    port: Number.parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return _transport;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

/**
 * Send an email via the configured SMTP transport. Throws on any
 * failure so the caller (scheduler) can record `lastStatus: "error"`.
 */
export async function sendEmail(opts: EmailOptions): Promise<void> {
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "reports@localhost",
    to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

/** Returns true when SMTP is configured and available. */
export function isSmtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}
