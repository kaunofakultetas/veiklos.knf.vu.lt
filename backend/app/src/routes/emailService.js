// -----------------------------------------------------------
//  [*] Email — activity status notifications
//
//  Plain-text Lithuanian emails sent to an employee when a
//  manager rejects or returns their activity, delivered
//  through Mailjet's SMTP relay (in-v3.mailjet.com:587,
//  STARTTLS). Mailjet
//  authenticates the relay with the account's API key /
//  secret (MAILJET_APIKEY / MAILJET_APISECRET); the sender
//  address is MAIL_FROM_ADDRESS, whose domain must be
//  validated in the Mailjet account. Inside docker the relay
//  hostname is pinned to the veiklos-exit layer4 proxy
//  (compose extra_hosts), which forwards port 587 out.
//
//  Both senders are fire-and-forget from the caller's side —
//  activities.js .catch()es failures and only logs them, so a
//  broken mail setup never blocks the status change itself.
// -----------------------------------------------------------

import nodemailer from "nodemailer";


// Mailjet's SMTP relay — a fixed fact of the provider
const MAILJET_SMTP_HOST = "in-v3.mailjet.com";
const MAILJET_SMTP_PORT = 587;

// The From header: fixed display name, deployment's address
const FROM_NAME = "Veiklų registravimo sistema";
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS;

// One shared transporter; nodemailer pools connections itself
const transporter = nodemailer.createTransport({
  host: MAILJET_SMTP_HOST,
  port: MAILJET_SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.MAILJET_APIKEY,
    pass: process.env.MAILJET_APISECRET,
  },
});







// -----------------------------------------------------------
// sendRejectionEmail
// -----------------------------------------------------------
//
// "Jūsų veikla buvo atmesta" — sent on the manager's "deny"
// action, with the rejection comment as the reason.
//
// Used by:
//   - routes/activities.js — PATCH /api/activities/:id/manager
// -----------------------------------------------------------

export async function sendRejectionEmail({ to, fullName, title, comment }) {
    const subject = `Jūsų veikla buvo atmesta: ${title}`;
    const text = `
Sveiki, ${fullName || ""}

Jūsų veikla "${title}" buvo atmesta.

Priežastis:
${comment}

Jei manote, kad tai klaida, susisiekite su vadybininke.
`;

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to,
    subject,
    text,
  });
}







// -----------------------------------------------------------
// sendReturnEmail
// -----------------------------------------------------------
//
// "Jūsų veikla buvo grąžinta tikslinimui" — sent on the
// manager's "return" action, with the manager's comment.
//
// Used by:
//   - routes/activities.js — PATCH /api/activities/:id/manager
// -----------------------------------------------------------

export async function sendReturnEmail({ to, fullName, title, comment }) {
    const subject = `Jūsų veikla buvo grąžinta tikslinimui: ${title}`;
    const text = `
Sveiki, ${fullName || ""}

Jūsų veikla "${title}" buvo grąžinta tikslinimui.

Vadybininkės komentaras:
${comment}

Jei manote, kad tai klaida, susisiekite su vadybininke.
`;

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to,
    subject,
    text,
  });
}
