// -----------------------------------------------------------
//  [*] Regression — routes/emailService.js
//
//  nodemailer is mocked (helpers/mailMock.js) and the Mailjet
//  env is set BEFORE the module import below, because the
//  transporter is created at import time from process.env.
//  Pins the Mailjet relay transport settings and both
//  Lithuanian message templates.
// -----------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { outbox, transportConfigs, mailControl } from "./helpers/mailMock.js";


process.env.MAILJET_APIKEY = "mj-api-key";
process.env.MAILJET_APISECRET = "mj-api-secret";
process.env.MAIL_FROM_ADDRESS = "noreply@test.local";

const { sendRejectionEmail, sendReturnEmail } = await import("../src/routes/emailService.js");


beforeEach(() => {
  outbox.length = 0;
  mailControl.reject = null;
});







// -----------------------------------------------------------
// transport config
// -----------------------------------------------------------
//
// createTransport captured at import time: Mailjet's relay
// host and port are fixed in code, the auth is the API
// key / secret from the env set above; secure false means
// STARTTLS.
// -----------------------------------------------------------

test("one shared transporter to Mailjet's relay, API key/secret as auth (secure: false)", () => {
  assert.equal(transportConfigs.length, 1);
  assert.deepEqual(transportConfigs[0], {
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
    auth: { user: "mj-api-key", pass: "mj-api-secret" },
  });
});







// -----------------------------------------------------------
// rejection — template
// -----------------------------------------------------------
//
// From (fixed name + MAIL_FROM_ADDRESS), subject prefix and
// every body field pinned against the outbox copy.
// -----------------------------------------------------------

test("rejection: system from-name, atmesta subject, comment as the reason", async () => {
  await sendRejectionEmail({
    to: "jonas@vu.lt",
    fullName: "Jonas Jonaitis",
    title: "Konferencija",
    comment: "Trūksta priedo",
  });

  assert.equal(outbox.length, 1);
  const msg = outbox[0];
  assert.equal(msg.from, '"Veiklų registravimo sistema" <noreply@test.local>');
  assert.equal(msg.to, "jonas@vu.lt");
  assert.equal(msg.subject, "Jūsų veikla buvo atmesta: Konferencija");
  assert.ok(msg.text.includes("Sveiki, Jonas Jonaitis"));
  assert.ok(msg.text.includes('Jūsų veikla "Konferencija" buvo atmesta.'));
  assert.ok(msg.text.includes("Priežastis:\nTrūksta priedo"));
});







// -----------------------------------------------------------
// rejection — no fullName
// -----------------------------------------------------------
//
// The greeting degrades to 'Sveiki, ' — the template
// tolerates a missing name.
// -----------------------------------------------------------

test("rejection: missing fullName degrades to an empty greeting, no crash", async () => {
  await sendRejectionEmail({ to: "x@x", title: "T", comment: "C" });
  assert.ok(outbox[0].text.includes("Sveiki, \n"));
});







// -----------------------------------------------------------
// rejection — relay failure
// -----------------------------------------------------------
//
// The fake transporter throws; the promise must reject
// so callers can .catch (activities.js relies on it).
// -----------------------------------------------------------

test("rejection: transporter failure rejects — the CALLER must catch (activities.js does)", async () => {
  mailControl.reject = new Error("relay down");
  await assert.rejects(() => sendRejectionEmail({ to: "x@x", title: "T", comment: "C" }));
});







// -----------------------------------------------------------
// return — template
// -----------------------------------------------------------
//
// The subject and the vadybininkės-komentaras block of
// the grąžinta variant.
// -----------------------------------------------------------

test("return: grąžinta subject and the manager's comment", async () => {
  await sendReturnEmail({
    to: "jonas@vu.lt",
    fullName: "Jonas",
    title: "Konferencija",
    comment: "Patikslinkite datą",
  });

  const msg = outbox[0];
  assert.equal(msg.subject, "Jūsų veikla buvo grąžinta tikslinimui: Konferencija");
  assert.ok(msg.text.includes('Jūsų veikla "Konferencija" buvo grąžinta tikslinimui.'));
  assert.ok(msg.text.includes("Vadybininkės komentaras:\nPatikslinkite datą"));
});
