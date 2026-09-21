// -----------------------------------------------------------
//  [*] Email — activity status notifications
//
//  Plain-text Lithuanian emails sent to an employee when a
//  manager rejects or returns their activity. SMTP settings
//  come from the environment (SMTP_HOST/PORT/USER/PASS);
//  secure:false means STARTTLS on the usual port 587.
//
//  Both senders are fire-and-forget from the caller's side —
//  activities.js .catch()es failures and only logs them, so a
//  broken SMTP setup never blocks the status change itself.
// -----------------------------------------------------------

import nodemailer from "nodemailer";


// One shared transporter; nodemailer pools connections itself
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
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
    const fromEmail = process.env.SMTP_USER;
    const fromName  = "Veiklų registravimo sistema";
    const subject = `Jūsų veikla buvo atmesta: ${title}`;
    const text = `
Sveiki, ${fullName || ""}

Jūsų veikla "${title}" buvo atmesta.

Priežastis:
${comment}

Jei manote, kad tai klaida, susisiekite su vadybininke.
`;

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
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
    const fromEmail = process.env.SMTP_USER;
    const fromName  = "Veiklų registravimo sistema";
    const subject = `Jūsų veikla buvo grąžinta tikslinimui: ${title}`;
    const text = `
Sveiki, ${fullName || ""}

Jūsų veikla "${title}" buvo grąžinta tikslinimui.

Vadybininkės komentaras:
${comment}

Jei manote, kad tai klaida, susisiekite su vadybininke.
`;

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
  });
}
