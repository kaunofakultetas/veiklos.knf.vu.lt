// -----------------------------------------------------------
//  [*] Test helpers — mocked nodemailer
//
//  Importing this module replaces the whole nodemailer
//  package (node:test module mock, so import it before any
//  module that pulls in routes/emailService.js). The fake
//  transporter records createTransport configs and pushes
//  every sent message into `outbox`; setting
//  `mailControl.reject` makes the next sends fail, to prove
//  the fire-and-forget contract.
// -----------------------------------------------------------

import { mock } from "node:test";


// Everything "sent" through the fake transporter
export const outbox = [];

// createTransport configs, for pinning the relay settings
export const transportConfigs = [];

// Set .reject to an Error to make sendMail throw it
export const mailControl = { reject: null };


mock.module("nodemailer", {
  defaultExport: {
    createTransport(cfg) {
      transportConfigs.push(cfg);
      return {
        sendMail: async (msg) => {
          if (mailControl.reject) throw mailControl.reject;
          outbox.push(msg);
          return { accepted: [msg.to] };
        },
      };
    },
  },
});
