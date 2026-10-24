// -----------------------------------------------------------
//  [*] Regression — routes /api/activities
//
//  The core status machine: PATEIKTA → (manager) PATVIRTINTA/
//  ATMESTA/TIKSLINTI → (committee) ĮVERTINTA, and back. Pins
//  the guards per role area, multipart upload naming, the
//  latin1→utf8 attachment-name re-decode on POST and PATCH,
//  the manager/committee verdict rules with their exact
//  Lithuanian messages (including the shipped "Paketiimai"
//  typo), the deny/return notification emails and their
//  fire-and-forget contract, the attachment download's
//  ownership-not-active-role authorization, and the hard
//  edges: no upload outlives a refused or aborted request, a
//  blank title is no title, verdict input the route does not
//  expect is refused, ids Postgres cannot take are 404s, text
//  fields are limited, and no single request can end the
//  whole process.
//
//  verifySamlSession/attachRoles are mocked;
//  requireActiveRoleIn is
//  real; nodemailer is mocked; multer writes real files into
//  uploads/ (tracked and removed after the run).
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Writable } from "node:stream";
import { signInAs, signOut } from "./helpers/authMock.js";
import { outbox, mailControl } from "./helpers/mailMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


// Where multer really writes during these tests; every file a
// test creates lands in createdFiles and is removed in after()
const uploadDir = path.join(process.cwd(), "uploads");
const createdFiles = new Set();

let app;

before(async () => {
  app = await startRouter(
    "/api/activities",
    new URL("../src/routes/activities.js", import.meta.url).href
  );
});

after(async () => {
  await app.close();
  for (const f of createdFiles) {
    fs.rmSync(path.join(uploadDir, f), { force: true });
  }
});

beforeEach(() => {
  resetDb();
  signOut();
  outbox.length = 0;
  mailControl.reject = null;
});







// -----------------------------------------------------------
// asRole
// -----------------------------------------------------------
//
// The X-Active-Role header the real requireActiveRoleIn guard
// reads.
//
// Used by:
//   - nearly every test in this file
// -----------------------------------------------------------

const asRole = (role) => ({ "X-Active-Role": role });







// -----------------------------------------------------------
// employee
// -----------------------------------------------------------
//
// Signs the mocked identity in as the employee "emp-1" — the
// eid the ownership tests treat as the activity's author.
//
// Used by:
//   - the create / my / edit / delete / resubmit tests (below)
// -----------------------------------------------------------

const employee = () => signInAs("emp-1", ["Darbuotojas"]);







// -----------------------------------------------------------
// manager
// -----------------------------------------------------------
//
// Signs in as a role-owning manager.
//
// Used by:
//   - the /pending, /all and verdict tests (below)
// -----------------------------------------------------------

const manager = () => signInAs("mgr-1", ["Vadybininkas"]);







// -----------------------------------------------------------
// committee
// -----------------------------------------------------------
//
// Signs in as a committee member.
//
// Used by:
//   - the /committee, /evaluated* and scoring tests (below)
// -----------------------------------------------------------

const committee = () => signInAs("com-1", ["Komisijos narys"]);







// -----------------------------------------------------------
// activityForm
// -----------------------------------------------------------
//
// A create/edit multipart body; the codes are appended BEFORE
// the file on purpose — multer's filename callback reads them
// from req.body, which only holds fields seen so far. An
// array value sends its field once per element: the repeated
// field multer hands the route as an array.
//
// Used by:
//   - the POST / and PATCH /:id tests (below)
// -----------------------------------------------------------

function activityForm({ file, fileName, fileType = "text/plain", ...fields }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of [].concat(v)) form.append(k, one);
  }
  if (file !== undefined) {
    form.append("attachment", new Blob([file], { type: fileType }), fileName);
  }
  return form;
}







// -----------------------------------------------------------
// stubFullName
// -----------------------------------------------------------
//
// loadUserFullName's lookup, needed by every multipart route.
//
// Used by:
//   - the POST / and PATCH /:id tests (below)
// -----------------------------------------------------------

function stubFullName(name = "Jonas Jonaitis") {
  onQuery(/SELECT full_name FROM users WHERE eid = \$1/, name ? [{ full_name: name }] : []);
}


// The theme/subtheme pairing check every write runs when ids
// are given (subthemeMatchesTheme): ok → one row, else none
function stubPair(ok = true) {
  onQuery(/SELECT 1 FROM subthemes/, ok ? [{ "?column?": 1 }] : []);
}







// -----------------------------------------------------------
// guards — wrong active role
// -----------------------------------------------------------
//
// Employee, manager and committee endpoints each probed
// with the other side's active role → 403.
// -----------------------------------------------------------

test("role areas reject the wrong ACTIVE role", async () => {
  manager();
  let res = await api(app.base, "GET", "/api/activities/my", { headers: asRole("Vadybininkas") });
  assert.equal(res.status, 403);

  employee();
  res = await api(app.base, "GET", "/api/activities/pending", { headers: asRole("Darbuotojas") });
  assert.equal(res.status, 403);

  manager();
  res = await api(app.base, "GET", "/api/activities/committee", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 403);
});







// -----------------------------------------------------------
// guards — anonymous
// -----------------------------------------------------------
//
// No identity → the mocked verifySamlSession's 401 before any
// route logic.
// -----------------------------------------------------------

test("anonymous → 401 everywhere", async () => {
  const res = await api(app.base, "GET", "/api/activities/my");
  assert.equal(res.status, 401);
});







// -----------------------------------------------------------
// create — validation
// -----------------------------------------------------------
//
// Multipart with only a title → the required-fields
// 400.
// -----------------------------------------------------------

test("create: missing theme/subtheme/title → 400", async () => {
  employee();
  stubFullName();
  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ title: "X" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Tema, potemė ir pavadinimas yra privalomi" });
});







// -----------------------------------------------------------
// create — a blank title is no title
// -----------------------------------------------------------
//
// A title of spaces only is trimmed to nothing, so it is
// refused like a missing one — as the edit route refuses it
// as Netinkamas pavadinimas — and nothing is inserted.
// -----------------------------------------------------------

test("create: a whitespace-only title → 400, no INSERT", async () => {
  employee();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [
    { id: 1, employee_eid: params[0], title: params[3], status: "PATEIKTA" },
  ]);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ theme_id: "1", subtheme_id: "2", title: "   " }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Tema, potemė ir pavadinimas yra privalomi" });
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
});







// -----------------------------------------------------------
// create — no attachment
// -----------------------------------------------------------
//
// INSERT params pin the trimming and the two null
// attachment columns; 201 echoes the row.
// -----------------------------------------------------------

test("create: trims title/description, null attachment columns without a file → 201", async () => {
  employee();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [
    { id: 1, employee_eid: params[0], title: params[3], status: "PATEIKTA" },
  ]);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({
      theme_id: "1",
      subtheme_id: "2",
      title: "  Konferencija  ",
      description: "  Aprašymas  ",
    }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 201);

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO activities"));
  assert.deepEqual(insert.params, ["emp-1", 1, 2, "Konferencija", "Aprašymas", null, null]);
});







// -----------------------------------------------------------
// create — attachment naming
// -----------------------------------------------------------
//
// A real multer write: the filename pattern pins
// cleanSegment (Lithuanian letters dropped from the
// author's name), and the original name arrives
// utf8-restored in the INSERT.
// -----------------------------------------------------------

test("create with attachment: sanitized theme-subtheme-user prefix, original name utf8-restored", async () => {
  employee();
  stubFullName("Žana Kazlauskaitė");
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [{ id: 2, title: params[3] }]);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({
      theme_id: "1",
      subtheme_id: "2",
      title: "Su priedu",
      description: "x",
      theme_code: "T1",
      subtheme_code: "T1.1",
      file: "turinys",
      fileName: "Ataskaita ūžė.txt",
    }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 201);

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO activities"));
  const storedName = insert.params[5];
  createdFiles.add(storedName);

  // cleanSegment drops Lithuanian letters entirely — "Žana
  // Kazlauskaitė" becomes "ana_kazlauskait" (pinned quirk)
  assert.match(storedName, /^t1-t1\.1-ana_kazlauskait-\d+-\d+\.txt$/);
  assert.ok(fs.existsSync(path.join(uploadDir, storedName)), "multer wrote the file");

  // POST re-decodes the latin1-mangled original name
  assert.equal(insert.params[6], "Ataskaita ūžė.txt");
});







// -----------------------------------------------------------
// snapshotUploads
// -----------------------------------------------------------
//
// The set of files in uploadDir right now — a refused upload
// must leave it unchanged.
//
// Used by:
//   - the attachment type/size tests (below)
// -----------------------------------------------------------

function snapshotUploads() {
  return new Set(fs.readdirSync(uploadDir));
}


// The multipart fields every create needs besides the file
const BASE_CREATE = { theme_id: "1", subtheme_id: "2", title: "Su priedu", theme_code: "T1", subtheme_code: "T1.1" };







// -----------------------------------------------------------
// create — refused attachment types
// -----------------------------------------------------------
//
// Executables, scripts, markup and archives are refused by
// extension BEFORE a byte lands on disk: 400 with the
// allowlist in the message, no INSERT, uploadDir untouched.
// A double extension counts by its last part.
// -----------------------------------------------------------

test("create: dangerous attachment types → 400, nothing written, no INSERT", async () => {
  employee();
  stubFullName();
  const before = snapshotUploads();

  for (const fileName of ["virus.exe", "run.sh", "page.html", "icon.svg", "bundle.zip", "report.pdf.exe", "noext"]) {
    const res = await api(app.base, "POST", "/api/activities", {
      form: activityForm({ ...BASE_CREATE, file: "x", fileName }),
      headers: asRole("Darbuotojas"),
    });
    assert.equal(res.status, 400, fileName);
    assert.match(res.body.error, /^Klaida: neleistinas priedo tipas\. Leidžiami: pdf, /, fileName);
  }

  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
  assert.deepEqual(snapshotUploads(), before);
});







// -----------------------------------------------------------
// create — extension normalized
// -----------------------------------------------------------
//
// "Ataskaita.PDF" with real PDF bytes is accepted and stored
// under a lowercase .pdf; the original name is kept as sent.
// -----------------------------------------------------------

test("create: allowed type with an uppercase extension is stored lowercase", async () => {
  employee();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [{ id: 2, title: params[3] }]);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, file: "%PDF-1.4\n%turinys", fileName: "Ataskaita.PDF", fileType: "application/pdf" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 201);

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO activities"));
  createdFiles.add(insert.params[5]);
  assert.match(insert.params[5], /\.pdf$/);
  assert.equal(insert.params[6], "Ataskaita.PDF");
  assert.ok(fs.existsSync(path.join(uploadDir, insert.params[5])));
});







// -----------------------------------------------------------
// create — no dot-named files
// -----------------------------------------------------------
//
// The stored name starts with the cleaned theme code, and
// cleaning drops every Lithuanian letter, so a code that
// begins with one can leave a leading dot. The download
// (send, behind res.download) refuses such a "dotfile" with a
// 404, so the file could never be fetched again: a stored
// name never starts with a dot.
// -----------------------------------------------------------

test("create: a theme code that cleans to a leading dot still stores a downloadable file", async () => {
  employee();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [{ id: 4, title: params[3] }]);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, theme_code: "Š.1", subtheme_code: "Š.1.1", file: "turinys", fileName: "priedas.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 201);
  const stored = queryLog().find((q) => q.sql.includes("INSERT INTO activities")).params[5];
  createdFiles.add(stored);
  assert.ok(!stored.startsWith("."), `stored as ${stored}`);

  resetDb();
  stubAttachmentRow({ attachment_path: stored });
  const download = await api(app.base, "GET", "/api/activities/4/attachment");
  assert.equal(download.status, 200);
  assert.equal(download.text, "turinys");
});







// -----------------------------------------------------------
// create — magic bytes
// -----------------------------------------------------------
//
// An allowed extension with the wrong content (an "exe"
// renamed to .pdf, a text file called .png) is refused
// AFTER multer stored it — and the stored file is removed
// again, so uploadDir ends up unchanged.
// -----------------------------------------------------------

test("create: allowed extension but wrong magic bytes → 400 and the stored file is removed", async () => {
  employee();
  stubFullName();
  const before = snapshotUploads();

  for (const [fileName, content] of [["report.pdf", "MZ\x90\x00 not a pdf"], ["photo.png", "just text"]]) {
    const res = await api(app.base, "POST", "/api/activities", {
      form: activityForm({ ...BASE_CREATE, file: content, fileName }),
      headers: asRole("Darbuotojas"),
    });
    assert.equal(res.status, 400, fileName);
    assert.match(res.body.error, /neleistinas priedo tipas/, fileName);
  }

  // the unlink is fire-and-forget — give it a beat
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
  assert.deepEqual(snapshotUploads(), before);
});







// -----------------------------------------------------------
// create — size limit
// -----------------------------------------------------------
//
// One byte over 100 MB → multer's LIMIT_FILE_SIZE, turned
// into the "per didelis" 400; nothing inserted. (The
// frontend refuses the same size before sending, and the
// ingress caps bodies at 110 MB — this pins the backend's
// own limit, the one that holds for direct API calls.)
// -----------------------------------------------------------

test("create: an attachment over 100 MB → 400 per didelis", async () => {
  employee();
  stubFullName();

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, file: "x".repeat(100 * 1024 * 1024 + 1), fileName: "didelis.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: priedas per didelis (iki 100 MB)" });
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
});







// -----------------------------------------------------------
// create — a refused request keeps no upload
// -----------------------------------------------------------
//
// multer stores the attachment before the handler looks at
// the fields, so every refusal after that point must remove
// the stored file again: a missing title, a subtheme of
// another theme, a database error. Otherwise each refused
// request would leave up to 100 MB on disk that no row
// points at, and any signed-in employee could fill the disk
// that way.
// -----------------------------------------------------------

test("create: a request refused after the upload leaves no file behind", async () => {
  employee();
  const before = snapshotUploads();

  // no title
  stubFullName();
  let res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, title: "", file: "x", fileName: "be-pavadinimo.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);

  // a subtheme of another theme
  resetDb();
  stubFullName();
  stubPair(false);
  res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, file: "x", fileName: "ne-ta-tema.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);

  // the INSERT fails
  resetDb();
  stubFullName();
  stubPair(true);
  onQuery(/INSERT INTO activities/, () => {
    throw Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  });
  res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, file: "x", fileName: "db-klaida.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 500);

  // an unlink would be fire-and-forget — give it a beat
  await new Promise((r) => setTimeout(r, 100));
  const left = [...snapshotUploads()].filter((f) => !before.has(f));
  for (const f of left) createdFiles.add(f);
  assert.deepEqual(left, [], "refused uploads must not stay on disk");
});







// -----------------------------------------------------------
// create — the server cannot store the file
// -----------------------------------------------------------
//
// A write that fails on the server's side — the disk full,
// the uploads folder unwritable — is no fault of the
// employee's: it is answered like every other server error,
// a 500 with the cause in the log, never the 400 a broken
// upload gets.
// -----------------------------------------------------------

test("create: a file the server cannot write (disk full) → 500 with the cause logged", async (t) => {
  employee();
  stubFullName();
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.map(String).join(" ")));
  t.mock.method(fs, "createWriteStream", () => new Writable({
    write(_chunk, _encoding, done) {
      done(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28, syscall: "write" }));
    },
  }));

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, file: "turinys", fileName: "priedas.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "internal error" });
  assert.ok(logged.some((line) => line.includes("ENOSPC")), "the cause is logged");
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
});







// -----------------------------------------------------------
// create — a description that is not text
// -----------------------------------------------------------
//
// The form always sends text, but the route takes whatever
// arrives: a repeated multipart field comes as an array, and
// a JSON body (which multer lets through) can carry a number
// or null. A description that is not text is a 400 before
// any query, not a 500 from its trim; null counts as no
// description, stored as the empty text.
// -----------------------------------------------------------

test("create: a description that is not text → 400 before any query; null counts as none", async () => {
  employee();
  stubFullName();
  let res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ ...BASE_CREATE, description: ["Pirmas", "Antras"] }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Netinkamas aprašymas" });

  resetDb();
  stubFullName();
  res = await api(app.base, "POST", "/api/activities", {
    body: { theme_id: 1, subtheme_id: 2, title: "X", description: 5 },
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Netinkamas aprašymas" });
  assert.equal(queryLog().some((q) => /FROM subthemes|INSERT/.test(q.sql)), false);

  resetDb();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [{ id: 3, title: params[3] }]);
  res = await api(app.base, "POST", "/api/activities", {
    body: { theme_id: 1, subtheme_id: 2, title: "X", description: null },
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 201);
  assert.equal(queryLog().find((q) => q.sql.includes("INSERT INTO activities")).params[4], "");
});







// -----------------------------------------------------------
// list — /my
// -----------------------------------------------------------
//
// WHERE employee_eid = caller pinned via the bound
// param; DESC ordering in the matcher.
// -----------------------------------------------------------

test("GET /my: scoped to the caller's eid, newest first", async () => {
  employee();
  onQuery(/WHERE a\.employee_eid = \$1 ORDER BY a\.created_at DESC/, [{ id: 1 }]);

  const res = await api(app.base, "GET", "/api/activities/my", {
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(queryLog()[0].params, ["emp-1"]);
});







// -----------------------------------------------------------
// list — /all
// -----------------------------------------------------------
//
// The manager's overview: the join-heavy SQL runs with
// NO status filter at all.
// -----------------------------------------------------------

test("GET /all (manager): every status, no WHERE", async () => {
  manager();
  onQuery(/FROM activities a JOIN users u/, [{ id: 1 }, { id: 2 }]);

  const res = await api(app.base, "GET", "/api/activities/all", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);
  assert.ok(!queryLog()[0].sql.includes("WHERE"));
});







// -----------------------------------------------------------
// list — status literals
// -----------------------------------------------------------
//
// The two committee queues matched by their verbatim
// Lithuanian status literals — the Į included.
// -----------------------------------------------------------

test("GET /committee: only PATVIRTINTA; /evaluated: only ĮVERTINTA (Į verbatim in SQL)", async () => {
  committee();
  onQuery(/WHERE a\.status = 'PATVIRTINTA'/, []);
  let res = await api(app.base, "GET", "/api/activities/committee", {
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);

  resetDb();
  onQuery(/WHERE a\.status = 'ĮVERTINTA' ORDER BY a\.updated_at DESC/, []);
  res = await api(app.base, "GET", "/api/activities/evaluated", {
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// list — theme totals
// -----------------------------------------------------------
//
// The LEFT JOIN is pinned so scoreless themes still
// report a 0 total.
// -----------------------------------------------------------

test("GET /evaluated/theme-totals: LEFT JOIN keeps score-less themes at 0", async () => {
  committee();
  onQuery(/LEFT JOIN activities a/, [
    { theme_id: 1, theme_code: "T1", total_score: "0" },
  ]);

  const res = await api(app.base, "GET", "/api/activities/evaluated/theme-totals", {
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.ok(queryLog()[0].sql.includes("LEFT JOIN"));
});







// -----------------------------------------------------------
// list — calculate feeds
// -----------------------------------------------------------
//
// The DISTINCT employee list, then one employee's
// grouped sums with the eid bound as a param.
// -----------------------------------------------------------

test("GET /evaluated/employees + /evaluated/employee/:eid/subthemes", async () => {
  committee();
  onQuery(/SELECT DISTINCT u\.eid/, [{ eid: "emp-1", full_name: "J", email: "j@x" }]);
  let res = await api(app.base, "GET", "/api/activities/evaluated/employees", {
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);

  resetDb();
  onQuery(/COALESCE\(SUM\(a\.score\), 0\) AS total_score/, []);
  res = await api(app.base, "GET", "/api/activities/evaluated/employee/emp-1/subthemes", {
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(queryLog()[0].params, ["emp-1"]);
});







// -----------------------------------------------------------
// list — /pending
// -----------------------------------------------------------
//
// PATEIKTA plus ASC ordering — the review queue is
// worked oldest-first.
// -----------------------------------------------------------

test("GET /pending (manager): PATEIKTA queue, OLDEST first", async () => {
  manager();
  onQuery(/WHERE a\.status = 'PATEIKTA' ORDER BY a\.created_at ASC/, []);

  const res = await api(app.base, "GET", "/api/activities/pending", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// stubManagerPatch
// -----------------------------------------------------------
//
// The four queries a manager verdict can touch: the status
// gate, the UPDATE, the email-info lookup and the final
// select. Pass null to make the activity not exist.
//
// Used by:
//   - the PATCH /:id/manager tests (below)
// -----------------------------------------------------------

function stubManagerPatch(status = "PATEIKTA") {
  onQuery(/SELECT status FROM activities WHERE id = \$1/, status ? [{ status }] : []);
  onQuery(/UPDATE activities SET/, { rowCount: 1 });
  onQuery(/SELECT a\.title, a\.rejection_comment, u\.email, u\.full_name/, [
    { title: "Konferencija", rejection_comment: "Blogai", email: "jonas@vu.lt", full_name: "Jonas" },
  ]);
  onQuery(/SELECT a\.id, a\.employee_eid, a\.theme_id/, [{ id: 10, status: "updated" }]);
}







// -----------------------------------------------------------
// manager — status gate
// -----------------------------------------------------------
//
// An unknown id → 404; an ATMESTA row → the
// PATEIKTA-only 400 with its full message.
// -----------------------------------------------------------

test("manager verdict: 404 unknown; only PATEIKTA may be touched", async () => {
  manager();
  stubManagerPatch(null);
  let res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "approve" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);

  resetDb();
  stubManagerPatch("ATMESTA");
  res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "approve" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: "Klaida: Redaguoti / tvirtinti galima tik PATEIKTA būsenos veiklas.",
  });
});







// -----------------------------------------------------------
// manager — approve
// -----------------------------------------------------------
//
// UPDATE params pin PATVIRTINTA plus the null that
// clears an old rejection comment; the outbox stays
// empty.
// -----------------------------------------------------------

test("approve: → PATVIRTINTA, clears any old rejection comment, sends NO email", async () => {
  manager();
  stubManagerPatch();

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "approve" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, ["PATVIRTINTA", null, "10"]);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outbox.length, 0);
});







// -----------------------------------------------------------
// manager — deny
// -----------------------------------------------------------
//
// A comment-less deny → 400; with one, the params pin
// ATMESTA + the trimmed comment, and the atmesta email
// is built from the DB copy.
// -----------------------------------------------------------

test("deny: comment required; trims it; → ATMESTA + rejection email from the STORED comment", async () => {
  manager();
  stubManagerPatch();

  let res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "deny" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Atmetimui privalomas komentaras." });

  res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "deny", rejection_comment: "  Blogai  " },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, ["ATMESTA", "Blogai", "10"]);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "jonas@vu.lt");
  assert.equal(outbox[0].subject, "Jūsų veikla buvo atmesta: Konferencija");
});







// -----------------------------------------------------------
// manager — return
// -----------------------------------------------------------
//
// TIKSLINTI + comment in the UPDATE params, and the
// grąžinta subject lands in the outbox.
// -----------------------------------------------------------

test("return: → TIKSLINTI + the grąžinta email", async () => {
  manager();
  stubManagerPatch();

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "return", rejection_comment: "Patikslinkite" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, ["TIKSLINTI", "Patikslinkite", "10"]);

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outbox[0].subject, "Jūsų veikla buvo grąžinta tikslinimui: Konferencija");
});







// -----------------------------------------------------------
// manager — fire-and-forget
// -----------------------------------------------------------
//
// sendMail throws; the PATCH still answers 200 — the
// email promise is never awaited.
// -----------------------------------------------------------

test("deny: a dead mail relay does NOT fail the PATCH (fire-and-forget)", async () => {
  manager();
  stubManagerPatch();
  mailControl.reject = new Error("smtp down");

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "deny", rejection_comment: "Blogai" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// manager — plain edit
// -----------------------------------------------------------
//
// manager_comments only; the NaN theme_id vanishes from
// the SET (pinned via the update's SQL text).
// -----------------------------------------------------------

test("plain edit: manager_comments alone; NaN theme_id is silently ignored", async () => {
  manager();
  stubManagerPatch();

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { manager_comments: " pastaba ", theme_id: "abc" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.ok(update.sql.includes("manager_comments = $1"));
  assert.ok(!update.sql.includes("theme_id"));
  assert.deepEqual(update.params, ["pastaba", "10"]);
});







// -----------------------------------------------------------
// manager — the typo 400
// -----------------------------------------------------------
//
// An empty body hits the no-fields branch; the
// 'Paketiimai' string is pinned byte-for-byte.
// -----------------------------------------------------------

test('no usable fields → 400 with the shipped "Paketiimai" typo (load-bearing string)', async () => {
  manager();
  stubManagerPatch();

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: {},
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Paketiimai nepateikti" });
});







// -----------------------------------------------------------
// manager — comments that are not strings
// -----------------------------------------------------------
//
// A JSON null, a number or an array where the verdict
// expects a comment must not reach .trim() and answer 500. A
// deny/return comment that is not text is the "privalomas
// komentaras" 400; a null manager comment clears it, as on
// the committee route. Either way the answer is a 400 or a
// clean save, never a 500.
// -----------------------------------------------------------

test("manager verdict: a comment that is not a string → 400 or a clean save, never 500", async () => {
  manager();
  for (const body of [
    { action: "deny", rejection_comment: 5 },
    { action: "return", rejection_comment: ["Patikslinkite"] },
    { manager_comments: null },
    { manager_comments: 7 },
  ]) {
    resetDb();
    stubManagerPatch();
    const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
      body,
      headers: asRole("Vadybininkas"),
    });
    assert.ok(res.status === 200 || res.status === 400, `${JSON.stringify(body)} answered ${res.status}`);
  }
});







// -----------------------------------------------------------
// stubCommitteePatch
// -----------------------------------------------------------
//
// The committee verdict's three queries: status gate, UPDATE,
// final select. Pass null to make the activity not exist.
//
// Used by:
//   - the PATCH /:id/committee tests (below)
// -----------------------------------------------------------

function stubCommitteePatch(status = "PATVIRTINTA") {
  onQuery(/SELECT status FROM activities WHERE id = \$1/, status ? [{ status }] : []);
  onQuery(/UPDATE activities SET/, { rowCount: 1 });
  onQuery(/SELECT a\.id, a\.employee_eid/, [{ id: 10, status: "updated" }]);
}







// -----------------------------------------------------------
// committee — status gate
// -----------------------------------------------------------
//
// A PATEIKTA row → the PATVIRTINTA/ĮVERTINTA-only 400
// with its full message.
// -----------------------------------------------------------

test("committee: only PATVIRTINTA or ĮVERTINTA rows may be touched", async () => {
  committee();
  stubCommitteePatch("PATEIKTA");

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 1 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: "Klaida: Komisija gali tvarkyti tik PATVIRTINTA arba ĮVERTINTA būsenos veiklas.",
  });
});







// -----------------------------------------------------------
// committee — score validation
// -----------------------------------------------------------
//
// '' and 'abc' rejected with their messages; 0 is
// accepted and bound together with ĮVERTINTA.
// -----------------------------------------------------------

test("score: required and numeric; 0 is a valid score; → ĮVERTINTA", async () => {
  committee();
  stubCommitteePatch();

  let res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: "" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Įvertinimas privalomas." });

  res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: "abc" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Įvertinimas turi būti skaičius." });

  res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 0 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, [0, "ĮVERTINTA", "10"]);
});







// -----------------------------------------------------------
// committee — score bounds
// -----------------------------------------------------------
//
// The score is 1/n, so [0, 1] is the whole range: negative
// and > 1 values are refused before any UPDATE (they would
// skew the theme totals the calculator divides the budget
// by); in-range values are stored rounded to 2 decimals,
// exactly as the pages would have sent them.
// -----------------------------------------------------------

test("score: outside [0, 1] → 400, no UPDATE; in range → rounded to 2 decimals", async () => {
  committee();
  stubCommitteePatch();

  for (const score of [-1, -9999, 1.01, 999999999, "2"]) {
    const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
      body: { action: "score", score },
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 400, String(score));
    assert.deepEqual(res.body, { error: "Klaida: Įvertinimas turi būti tarp 0 ir 1." });
  }
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);

  for (const [score, stored] of [[1, 1], ["0.5", 0.5], [0.333333, 0.33], [1 / 7, 0.14]]) {
    resetDb();
    stubCommitteePatch();
    const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
      body: { action: "score", score },
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 200, String(score));
    const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
    assert.deepEqual(update.params, [stored, "ĮVERTINTA", "10"]);
  }
});







// -----------------------------------------------------------
// committee — re-scoring
// -----------------------------------------------------------
//
// An ĮVERTINTA row takes a new score plus a
// theme/subtheme reassignment — all five params
// pinned.
// -----------------------------------------------------------

test("re-scoring an ĮVERTINTA row is allowed (the results-page correction path)", async () => {
  committee();
  stubCommitteePatch("ĮVERTINTA");
  stubPair();

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 0.5, theme_id: 3, subtheme_id: 7 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, [3, 7, 0.5, "ĮVERTINTA", "10"]);
});







// -----------------------------------------------------------
// stubReturnNotice
// -----------------------------------------------------------
//
// The two reads behind the managers' notice on a committee
// return: the activity (title, the committee's reason, the
// employee's name) and every holder of the manager role.
//
// Used by:
//   - the committee return tests (below)
// -----------------------------------------------------------

function stubReturnNotice(managers = []) {
  onQuery(/SELECT a\.title, a\.committee_comments/, [
    { title: "Konferencija", committee_comments: "Patikslinkite temą", full_name: "Jonas Jonaitis" },
  ]);
  onQuery(/JOIN user_roles ur ON ur\.user_eid = u\.eid/, managers);
}







// -----------------------------------------------------------
// committee — return
// -----------------------------------------------------------
//
// Back to PATEIKTA with the score nulled — the clean-slate
// contract for a re-approval — and the committee's reason
// stored in committee_comments, where the manager's queue
// shows it. A return without a reason is refused before
// anything is written: the manager would get the activity
// back with no idea why.
// -----------------------------------------------------------

test("return: → PATEIKTA with the score wiped and the reason stored", async () => {
  committee();
  stubCommitteePatch();
  stubReturnNotice();

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "return", committee_comments: " Patikslinkite temą " },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.deepEqual(update.params, ["PATEIKTA", null, "Patikslinkite temą", "10"]);
});

test("return without a reason → 400, nothing written", async () => {
  committee();
  for (const body of [{ action: "return" }, { action: "return", committee_comments: "   " }, { action: "return", committee_comments: 5 }]) {
    resetDb();
    stubCommitteePatch();
    const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
      body,
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error: "Klaida: Grąžinimui privalomas komentaras." });
    assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);
  }
});







// -----------------------------------------------------------
// committee — the managers hear of a return
// -----------------------------------------------------------
//
// Every holder of the manager role is mailed the returned
// activity, its employee and the committee's reason, read
// back from the database after the write. Fire-and-forget,
// like the employee's mails: a dead relay is only logged and
// the return stands.
// -----------------------------------------------------------

test("return: every manager is mailed the activity and the committee's reason", async () => {
  committee();
  stubCommitteePatch();
  stubReturnNotice([
    { email: "vadybininke@vu.lt", full_name: "Rūta Vadybininkė" },
    { email: "kitas@vu.lt", full_name: null },
  ]);

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "return", committee_comments: "Patikslinkite temą" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);

  assert.deepEqual(outbox.map((m) => m.to), ["vadybininke@vu.lt", "kitas@vu.lt"]);
  for (const msg of outbox) {
    assert.equal(msg.subject, "Komisija grąžino veiklą: Konferencija");
    assert.ok(msg.text.includes("Darbuotojas: Jonas Jonaitis"), msg.text);
    assert.ok(msg.text.includes("Komisijos komentaras:\nPatikslinkite temą"), msg.text);
  }
});

test("return: a dead mail relay does not fail the return", async () => {
  committee();
  stubCommitteePatch();
  stubReturnNotice([{ email: "vadybininke@vu.lt", full_name: "Rūta Vadybininkė" }]);
  mailControl.reject = new Error("relay down");

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "return", committee_comments: "Patikslinkite temą" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.ok(queryLog().some((q) => q.sql.startsWith("UPDATE activities")));
});







// -----------------------------------------------------------
// committee — empty body
// -----------------------------------------------------------
//
// The no-fields 400, correctly spelled on this route
// (unlike the manager's).
// -----------------------------------------------------------

test("committee empty body → 400, correctly spelled here", async () => {
  committee();
  stubCommitteePatch();

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: {},
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Pakeitimai nepateikti" });
});







// -----------------------------------------------------------
// score — values that are not numbers
// -----------------------------------------------------------
//
// Number() would turn a blank string, a boolean, a
// one-element array and a hex or binary string into a
// valid-looking score — " " stored as 0 and true as 1, with
// the activity marked ĮVERTINTA. Only a number, or a string
// spelling a decimal number, passes; anything else is a 400
// with nothing written.
// -----------------------------------------------------------

test("score: blank strings, booleans, arrays and hex strings → 400, no UPDATE", async () => {
  committee();
  for (const score of [" ", "\t", false, true, [0.5], "0x1", "0b1"]) {
    resetDb();
    stubCommitteePatch();
    const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
      body: { action: "score", score },
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 400, JSON.stringify(score));
    assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false, JSON.stringify(score));
  }
});







// -----------------------------------------------------------
// verdicts — an action nobody knows
// -----------------------------------------------------------
//
// An action that is present but not one the route knows is
// refused with a 400 before anything is written. Skipped in
// silence instead, "Approve" with a comment would save the
// comment, leave the activity PATEIKTA and answer 200, and
// "SCORE" with a score would drop the score the same way.
// -----------------------------------------------------------

test("verdicts: an unknown action → 400, nothing written", async () => {
  manager();
  stubManagerPatch();
  let res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "Approve", manager_comments: "Gerai" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);

  resetDb();
  committee();
  stubCommitteePatch();
  res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "SCORE", score: 0.5, committee_comments: "Gerai" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);
});







// -----------------------------------------------------------
// stubAttachmentRow
// -----------------------------------------------------------
//
// The download route's single lookup. Overrides use `in`
// checks, not ?? — an EXPLICIT null (row without a file) must
// survive as null.
//
// Used by:
//   - the GET /:id/attachment tests (below)
// -----------------------------------------------------------

function stubAttachmentRow(overrides = {}) {
  onQuery(/SELECT attachment_path, attachment_original_name, employee_eid/, [
    {
      attachment_path:
        "attachment_path" in overrides ? overrides.attachment_path : "test-attach.txt",
      attachment_original_name:
        "attachment_original_name" in overrides
          ? overrides.attachment_original_name
          : "Priedas ū.txt",
      employee_eid: "employee_eid" in overrides ? overrides.employee_eid : "emp-1",
    },
  ]);
}







// -----------------------------------------------------------
// attachment — owner
// -----------------------------------------------------------
//
// A real file on disk streams back under the ORIGINAL
// name; the content-disposition header is pinned.
// -----------------------------------------------------------

test("attachment: the owner downloads under the ORIGINAL name", async () => {
  const stored = `test-attach-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, stored), "priedo turinys");
  createdFiles.add(stored);

  employee();
  stubAttachmentRow({ attachment_path: stored });

  const res = await api(app.base, "GET", "/api/activities/10/attachment");
  assert.equal(res.status, 200);
  assert.equal(res.text, "priedo turinys");
  assert.ok(res.headers.get("content-disposition").includes("attachment"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});







// -----------------------------------------------------------
// attachment — stranger
// -----------------------------------------------------------
//
// A different eid with no privileged roles → the
// Draudžiama 403.
// -----------------------------------------------------------

test("attachment: a stranger without privileged roles → 403", async () => {
  signInAs("kitas-emp", ["Darbuotojas"]);
  stubAttachmentRow();

  const res = await api(app.base, "GET", "/api/activities/10/attachment");
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Klaida: Draudžiama" });
});







// -----------------------------------------------------------
// attachment — owned role
// -----------------------------------------------------------
//
// A manager BY OWNERSHIP downloads with no
// X-Active-Role header — the one route keyed to role
// ownership instead of the active role.
// -----------------------------------------------------------

test("attachment: merely OWNING Vadybininkas grants access — no X-Active-Role needed (pinned)", async () => {
  const stored = `test-attach-mgr-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, stored), "x");
  createdFiles.add(stored);

  signInAs("mgr-1", ["Vadybininkas"]);
  stubAttachmentRow({ attachment_path: stored });

  const res = await api(app.base, "GET", "/api/activities/10/attachment");
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// attachment — 404s
// -----------------------------------------------------------
//
// attachment_path null → Nėra priedo; an empty lookup →
// Nerasta — two distinct 404 bodies.
// -----------------------------------------------------------

test("attachment: row without a file → 404 Nėra priedo; unknown id → 404 Nerasta", async () => {
  employee();
  stubAttachmentRow({ attachment_path: null });
  let res = await api(app.base, "GET", "/api/activities/10/attachment");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: Nėra priedo" });

  resetDb();
  onQuery(/SELECT attachment_path/, []);
  res = await api(app.base, "GET", "/api/activities/10/attachment");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: Nerasta" });
});







// -----------------------------------------------------------
// stubEmployeePatch
// -----------------------------------------------------------
//
// The employee edit's queries: the transaction around the
// locked ownership/status lookup (overridable) and the
// UPDATE, then the final select.
//
// Used by:
//   - the PATCH /:id tests (below)
// -----------------------------------------------------------

function stubEmployeePatch(cur = {}) {
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status, attachment_path FROM activities/, [
    {
      employee_eid: cur.employee_eid ?? "emp-1",
      status: cur.status ?? "PATEIKTA",
      attachment_path: cur.attachment_path ?? null,
    },
  ]);
  onQuery(/UPDATE activities SET/, { rowCount: 1 });
  onQuery(/SELECT a\.id, a\.theme_id/, [{ id: 10, status: "updated" }]);
}







// -----------------------------------------------------------
// edit — ownership + status
// -----------------------------------------------------------
//
// A stranger's PATCH → 403; a PATVIRTINTA row → the
// PATEIKTA/TIKSLINTI-only 400.
// -----------------------------------------------------------

test("employee edit: 403 for non-owners, 400 outside PATEIKTA/TIKSLINTI", async () => {
  employee();
  stubEmployeePatch({ employee_eid: "kitas" });
  stubFullName();
  let res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "X" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 403);

  resetDb();
  stubEmployeePatch({ status: "PATVIRTINTA" });
  stubFullName();
  res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "X" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: "Klaida: Redaguoti galima tik PATEIKTA arba TIKSLINTI būsenos veiklas.",
  });
});







// -----------------------------------------------------------
// edit — field validation
// -----------------------------------------------------------
//
// A NaN theme → Netinkama tema; a whitespace title →
// Netinkamas pavadinimas.
// -----------------------------------------------------------

test("employee edit: field validation (bad theme, blank title)", async () => {
  employee();
  stubEmployeePatch();
  stubFullName();

  let res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ theme_id: "abc", title: "X" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Netinkama tema" });

  resetDb();
  stubEmployeePatch();
  stubFullName();
  res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "   " }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Netinkamas pavadinimas" });
});







// -----------------------------------------------------------
// edit — a title or description that is not text
// -----------------------------------------------------------
//
// As on create: a title sent twice arrives as an array, and
// a JSON body can carry a number or null. A title or
// description that is not text is a 400 naming the field,
// with no UPDATE, never a 500 from the trim; a null
// description clears it to the empty text a create without
// one stores.
// -----------------------------------------------------------

test("employee edit: a title or description that is not text → 400; null clears the description", async () => {
  employee();
  stubEmployeePatch();
  stubFullName();
  let res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: ["Vienas", "Du"] }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Netinkamas pavadinimas" });

  for (const [body, error] of [
    [{ title: 5 }, "Klaida: Netinkamas pavadinimas"],
    [{ description: 5 }, "Klaida: Netinkamas aprašymas"],
    [{ description: ["a"] }, "Klaida: Netinkamas aprašymas"],
  ]) {
    resetDb();
    stubEmployeePatch();
    stubFullName();
    res = await api(app.base, "PATCH", "/api/activities/10", { body, headers: asRole("Darbuotojas") });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error });
    assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);
  }

  resetDb();
  stubEmployeePatch();
  stubFullName();
  res = await api(app.base, "PATCH", "/api/activities/10", {
    body: { description: null },
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);
  assert.equal(queryLog().find((q) => q.sql.includes("UPDATE activities SET")).params[0], "");
});







// -----------------------------------------------------------
// edit — one edit at a time
// -----------------------------------------------------------
//
// Two edits of one activity, each with a new file, must not
// both replace the same old file — that left the first
// edit's new file with no row pointing at it. The row is
// read FOR UPDATE inside a transaction the UPDATE commits,
// so a second edit waits for the first and then replaces the
// file the first one stored. The replaced file goes only
// after the commit, and a refused edit rolls back.
// -----------------------------------------------------------

test("employee edit: locked read, UPDATE and COMMIT in one transaction; the replaced file goes after the commit", async () => {
  employee();
  const old = `regression-old-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, old), "senas");
  createdFiles.add(old);
  stubEmployeePatch({ attachment_path: old });
  stubFullName();

  let res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ file: "naujas", fileName: "naujas.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);
  const sqls = queryLog().map((q) => q.sql);
  const at = (re) => sqls.findIndex((sql) => re.test(sql));
  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  createdFiles.add(update.params.find((p) => typeof p === "string" && p.endsWith(".txt")));
  assert.ok(at(/^BEGIN$/) >= 0, "a transaction is opened");
  assert.ok(at(/^BEGIN$/) < at(/FROM activities WHERE id = \$1 FOR UPDATE$/), "the row is read under a lock, inside it");
  assert.ok(at(/FOR UPDATE$/) < at(/^UPDATE activities/));
  assert.ok(at(/^UPDATE activities/) < at(/^COMMIT$/), "the UPDATE is committed");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(path.join(uploadDir, old)), false, "the replaced file is gone");

  resetDb();
  stubEmployeePatch({ employee_eid: "kitas" });
  stubFullName();
  res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "X" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 403);
  assert.ok(queryLog().some((q) => q.sql === "ROLLBACK"), "a refused edit rolls back");
  assert.equal(queryLog().some((q) => q.sql === "COMMIT"), false);
});







// -----------------------------------------------------------
// edit — partial SET
// -----------------------------------------------------------
//
// TIKSLINTI accepts edits; the title+description params
// pin the trimming and the SET shape.
// -----------------------------------------------------------

test("employee edit: TIKSLINTI is editable; text-only edit builds a partial SET", async () => {
  employee();
  stubEmployeePatch({ status: "TIKSLINTI" });
  stubFullName();

  const res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: " Naujas ", description: " Aprašas " }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.ok(update.sql.includes("title = $1"));
  assert.ok(update.sql.includes("description = $2"));
  // ...then the row id and the owner's eid — the UPDATE is
  // conditional on both (see the lost-race tests)
  assert.deepEqual(update.params, ["Naujas", "Aprašas", "10", "emp-1"]);
  assert.ok(update.sql.includes("AND employee_eid = $4 AND status IN ('PATEIKTA', 'TIKSLINTI')"));
});







// -----------------------------------------------------------
// edit — file replacement
// -----------------------------------------------------------
//
// A new upload lands on disk and the OLD file is
// unlinked (polled, since unlink is fire-and-forget) —
// the replacement flow end-to-end.
// -----------------------------------------------------------

test("employee edit with a new file: old file unlinked, replacement stored", async () => {
  const oldName = `test-old-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, oldName), "senas");
  createdFiles.add(oldName);

  employee();
  stubEmployeePatch({ attachment_path: oldName });
  stubFullName();

  const res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({
      title: "Su nauju priedu",
      theme_code: "T1",
      subtheme_code: "T1.1",
      file: "naujas turinys",
      fileName: "Ataskaita ūžė.txt",
    }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  const newName = update.params[1];
  createdFiles.add(newName);
  assert.ok(fs.existsSync(path.join(uploadDir, newName)), "new file written");

  // fs.unlink of the old file is callback-async — give it a beat
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fs.existsSync(path.join(uploadDir, oldName)), "old file removed");
});







// -----------------------------------------------------------
// edit — refused replacement
// -----------------------------------------------------------
//
// A dangerous replacement type is refused before the handler
// runs: 400, no UPDATE, and the OLD attachment stays on disk.
// -----------------------------------------------------------

test("employee edit with a dangerous file: 400, no UPDATE, old file kept", async () => {
  const oldName = `test-old-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, oldName), "senas");
  createdFiles.add(oldName);

  employee();
  stubEmployeePatch({ attachment_path: oldName });
  stubFullName();

  const res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "X", theme_code: "T1", subtheme_code: "T1.1", file: "x", fileName: "payload.exe" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /neleistinas priedo tipas/);
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);
  assert.ok(fs.existsSync(path.join(uploadDir, oldName)), "old file untouched");
});







// -----------------------------------------------------------
// edit — a refused edit keeps no upload
// -----------------------------------------------------------
//
// The replacement file is stored before the handler checks
// the row, so every refusal must remove it again: an unknown
// id, a stranger's activity, a row past PATEIKTA/TIKSLINTI,
// a blank title, a database error. Each would otherwise
// leave up to 100 MB on disk — even an employee PATCHing an
// activity that is not theirs would get their file stored.
// -----------------------------------------------------------

test("employee edit: a refused edit leaves no uploaded file behind", async () => {
  employee();
  const before = snapshotUploads();
  const patchWithFile = (fields, fileName) =>
    api(app.base, "PATCH", "/api/activities/10", {
      form: activityForm({ theme_code: "T1", subtheme_code: "T1.1", ...fields, file: "x", fileName }),
      headers: asRole("Darbuotojas"),
    });

  // unknown id
  stubFullName();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status, attachment_path FROM activities/, []);
  let res = await patchWithFile({ title: "X" }, "nera.txt");
  assert.equal(res.status, 404);

  // a stranger's activity
  resetDb();
  stubFullName();
  stubEmployeePatch({ employee_eid: "kitas" });
  res = await patchWithFile({ title: "X" }, "svetima.txt");
  assert.equal(res.status, 403);

  // a row the manager already approved
  resetDb();
  stubFullName();
  stubEmployeePatch({ status: "PATVIRTINTA" });
  res = await patchWithFile({ title: "X" }, "patvirtinta.txt");
  assert.equal(res.status, 400);

  // a blank title
  resetDb();
  stubFullName();
  stubEmployeePatch();
  res = await patchWithFile({ title: "   " }, "tuscias.txt");
  assert.equal(res.status, 400);

  // the UPDATE fails
  resetDb();
  stubFullName();
  onQuery(/SELECT employee_eid, status, attachment_path FROM activities/, [
    { employee_eid: "emp-1", status: "PATEIKTA", attachment_path: null },
  ]);
  onQuery(/UPDATE activities SET/, () => {
    throw Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  });
  res = await patchWithFile({ title: "X" }, "db-klaida.txt");
  assert.equal(res.status, 500);

  // an unlink would be fire-and-forget — give it a beat
  await new Promise((r) => setTimeout(r, 100));
  const left = [...snapshotUploads()].filter((f) => !before.has(f));
  for (const f of left) createdFiles.add(f);
  assert.deepEqual(left, [], "refused uploads must not stay on disk");
});







// -----------------------------------------------------------
// replacement — original name re-decoded
// -----------------------------------------------------------
//
// The same upload as on POST: the utf8-restored name lands
// in the UPDATE params, not multer's latin1-mangled one.
// -----------------------------------------------------------

test(
  "PATCH: the replacement's original name is utf8-restored like on POST",
  async () => {
    employee();
    stubEmployeePatch();
    stubFullName();

    await api(app.base, "PATCH", "/api/activities/10", {
      form: activityForm({
        title: "X",
        theme_code: "T1",
        subtheme_code: "T1.1",
        file: "x",
        fileName: "Ataskaita ūžė.txt",
      }),
      headers: asRole("Darbuotojas"),
    });

    const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
    createdFiles.add(update.params[1]);
    // params: [title, attachment_path, attachment_original_name, id]
    assert.equal(update.params[2], "Ataskaita ūžė.txt");
  }
);







// -----------------------------------------------------------
// delete — status message
// -----------------------------------------------------------
//
// PATVIRTINTA refuses; the message names only PATEIKTA
// although TIKSLINTI is deletable too — pinned
// verbatim.
// -----------------------------------------------------------

test("delete: owner-only; PATVIRTINTA refuses with the PATEIKTA-only message", async () => {
  employee();
  onQuery(/SELECT employee_eid, status FROM activities/, [
    { employee_eid: "emp-1", status: "PATVIRTINTA" },
  ]);

  const res = await api(app.base, "DELETE", "/api/activities/10", {
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  // TIKSLINTI is deletable too, but the message only mentions
  // PATEIKTA — pinned verbatim
  assert.deepEqual(res.body, { error: "Klaida: Galima ištrinti tik PATEIKTA būsenos veiklas." });
});







// -----------------------------------------------------------
// delete — the attachment goes with the row
// -----------------------------------------------------------
//
// A TIKSLINTI row deletes → 204, the DELETE asks for the
// stored path back (RETURNING attachment_path) and the file
// on disk is unlinked — the employee's upload is really
// erased, not orphaned.
// -----------------------------------------------------------

test("delete: TIKSLINTI (and PATEIKTA) rows delete → 204 and the disk file is removed", async () => {
  const stored = `test-del-${Date.now()}.txt`;
  fs.writeFileSync(path.join(uploadDir, stored), "ištrinamas priedas");
  createdFiles.add(stored);

  employee();
  onQuery(/SELECT employee_eid, status FROM activities/, [
    { employee_eid: "emp-1", status: "TIKSLINTI" },
  ]);
  onQuery(/DELETE FROM activities WHERE id = \$1/, [{ attachment_path: stored }]);

  const res = await api(app.base, "DELETE", "/api/activities/10", {
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 204);

  const del = queryLog().find((q) => q.sql.startsWith("DELETE FROM activities"));
  assert.ok(del.sql.endsWith("RETURNING attachment_path"), del.sql);

  // fs.unlink is callback-async — give it a beat
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fs.existsSync(path.join(uploadDir, stored)), "attachment removed with the row");
});







// -----------------------------------------------------------
// delete — no file, or a file already gone
// -----------------------------------------------------------
//
// A row without an attachment, and a row whose file is
// already missing on disk, both still delete cleanly → 204
// (ENOENT is ignored, nothing else is touched).
// -----------------------------------------------------------

test("delete: no attachment, or one already missing on disk → still 204", async () => {
  employee();
  for (const attachment_path of [null, `never-existed-${Date.now()}.pdf`]) {
    resetDb();
    onQuery(/SELECT employee_eid, status FROM activities/, [
      { employee_eid: "emp-1", status: "PATEIKTA" },
    ]);
    onQuery(/DELETE FROM activities WHERE id = \$1/, [{ attachment_path }]);

    const res = await api(app.base, "DELETE", "/api/activities/10", {
      headers: asRole("Darbuotojas"),
    });
    assert.equal(res.status, 204, String(attachment_path));
  }
});







// -----------------------------------------------------------
// resubmit — happy path
// -----------------------------------------------------------
//
// Owner + TIKSLINTI: the fixed UPDATE literal (status
// PATEIKTA, NULL comment) and the fresh row back.
// -----------------------------------------------------------

test("resubmit: TIKSLINTI-only, owner-only → PATEIKTA with the comment cleared", async () => {
  employee();
  onQuery(/SELECT employee_eid, status FROM activities/, [
    { employee_eid: "emp-1", status: "TIKSLINTI" },
  ]);
  onQuery(/UPDATE activities SET status = 'PATEIKTA', rejection_comment = NULL/, { rowCount: 1 });
  onQuery(/SELECT a\.id, a\.theme_id/, [{ id: 10, status: "PATEIKTA" }]);

  const res = await api(app.base, "POST", "/api/activities/10/resubmit", {
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "PATEIKTA");
});







// -----------------------------------------------------------
// resubmit — status gate
// -----------------------------------------------------------
//
// A PATEIKTA row → the TIKSLINTI-only 400 with its full
// message.
// -----------------------------------------------------------

test("resubmit: a PATEIKTA row cannot be resubmitted", async () => {
  employee();
  onQuery(/SELECT employee_eid, status FROM activities/, [
    { employee_eid: "emp-1", status: "PATEIKTA" },
  ]);

  const res = await api(app.base, "POST", "/api/activities/10/resubmit", {
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: "Klaida: Pateikti iš naujo galima tik TIKSLINTI būsenos veiklas.",
  });
});







// -----------------------------------------------------------
// twice
// -----------------------------------------------------------
//
// A query handler answering `first` on the first call and
// `then` on every later one — the status gate and the
// post-race re-read share one SQL text in some routes.
//
// Used by:
//   - the lost-race tests (below)
// -----------------------------------------------------------

function twice(first, then) {
  let calls = 0;
  return () => (calls++ === 0 ? first : then);
}







// -----------------------------------------------------------
// lost race — employee edit vs manager approval
// -----------------------------------------------------------
//
// The status gate still sees PATEIKTA, but by the time the
// UPDATE runs the manager has approved: the conditional
// UPDATE matches 0 rows → 409 naming the new status, and the
// attachment uploaded for the edit is removed again.
// -----------------------------------------------------------

test("edit: manager approves between the gate and the UPDATE → 409, upload dropped", async () => {
  employee();
  stubFullName();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status, attachment_path FROM activities/, [
    { employee_eid: "emp-1", status: "PATEIKTA", attachment_path: null },
  ]);
  onQuery(/UPDATE activities SET/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status FROM activities WHERE id = \$1/, [
    { employee_eid: "emp-1", status: "PATVIRTINTA" },
  ]);
  const before = snapshotUploads();

  const res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ title: "Vėlu", theme_code: "T1", subtheme_code: "T1.1", file: "x", fileName: "vėlu.txt" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, {
    error: "Klaida: veiklos būsena ką tik pasikeitė (dabar: PATVIRTINTA) — atnaujinkite puslapį",
  });

  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(snapshotUploads(), before, "the losing edit's upload is unlinked");
});







// -----------------------------------------------------------
// lost race — the loser's row is gone or not theirs
// -----------------------------------------------------------
//
// The same 0-row UPDATE answers 404 when the re-read finds
// nothing (deleted meanwhile) and 403 when the row now
// belongs to someone else.
// -----------------------------------------------------------

test("edit: a 0-row UPDATE answers 404 when the row vanished, 403 when it is not theirs", async () => {
  employee();

  for (const [reread, status, body] of [
    [[], 404, { error: "Klaida: Nerasta" }],
    [[{ employee_eid: "kitas", status: "PATEIKTA" }], 403, { error: "Klaida: Draudžiama" }],
  ]) {
    resetDb();
    stubFullName();
    onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
    onQuery(/SELECT employee_eid, status, attachment_path FROM activities/, [
      { employee_eid: "emp-1", status: "PATEIKTA", attachment_path: null },
    ]);
    onQuery(/UPDATE activities SET/, { rowCount: 0 });
    onQuery(/SELECT employee_eid, status FROM activities WHERE id = \$1/, reread);

    const res = await api(app.base, "PATCH", "/api/activities/10", {
      form: activityForm({ title: "X", theme_code: "T1", subtheme_code: "T1.1" }),
      headers: asRole("Darbuotojas"),
    });
    assert.equal(res.status, status);
    assert.deepEqual(res.body, body);
  }
});







// -----------------------------------------------------------
// lost race — manager verdict
// -----------------------------------------------------------
//
// Two managers on the same row: the gate saw PATEIKTA, the
// UPDATE (conditional on status = 'PATEIKTA') matches
// nothing → 409 with the status the other verdict set, and
// no notification email lookup happens.
// -----------------------------------------------------------

test("manager: a verdict that lost the race → 409, no email", async () => {
  manager();
  onQuery(/SELECT status FROM activities WHERE id = \$1/, [{ status: "PATEIKTA" }]);
  onQuery(/UPDATE activities SET/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status FROM activities WHERE id = \$1/, [
    { employee_eid: "emp-1", status: "ATMESTA" },
  ]);

  const res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { action: "approve" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /dabar: ATMESTA/);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.ok(update.sql.endsWith("WHERE id = $3 AND status = 'PATEIKTA'"), update.sql);
  assert.equal(queryLog().some((q) => q.sql.includes("u.email")), false);
});







// -----------------------------------------------------------
// lost race — committee verdict
// -----------------------------------------------------------
//
// The manager returned the activity while the committee was
// scoring it: the UPDATE is conditional on PATVIRTINTA/
// ĮVERTINTA and matches nothing → 409.
// -----------------------------------------------------------

test("committee: scoring a row the manager just returned → 409", async () => {
  committee();
  onQuery(/SELECT status FROM activities WHERE id = \$1/, [{ status: "PATVIRTINTA" }]);
  onQuery(/UPDATE activities SET/, { rowCount: 0 });
  onQuery(/SELECT employee_eid, status FROM activities WHERE id = \$1/, [
    { employee_eid: "emp-1", status: "PATEIKTA" },
  ]);

  const res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 1 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /dabar: PATEIKTA/);

  const update = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.ok(update.sql.includes("AND status IN ('PATVIRTINTA', 'ĮVERTINTA')"), update.sql);
});







// -----------------------------------------------------------
// lost race — delete and resubmit
// -----------------------------------------------------------
//
// Both employee routes write conditionally on owner + status;
// the gate and the re-read share one SQL text, so `twice`
// serves PATEIKTA/TIKSLINTI first and the moved-on status
// second. 0 rows → 409.
// -----------------------------------------------------------

test("delete and resubmit: the conditional write loses → 409 naming the new status", async () => {
  employee();
  onQuery(
    /SELECT employee_eid, status FROM activities WHERE id = \$1/,
    twice([{ employee_eid: "emp-1", status: "PATEIKTA" }], [{ employee_eid: "emp-1", status: "PATVIRTINTA" }])
  );
  onQuery(/DELETE FROM activities WHERE id = \$1/, { rowCount: 0 });

  const del = await api(app.base, "DELETE", "/api/activities/10", { headers: asRole("Darbuotojas") });
  assert.equal(del.status, 409);
  assert.match(del.body.error, /dabar: PATVIRTINTA/);
  const delSql = queryLog().find((q) => q.sql.startsWith("DELETE FROM activities"));
  assert.ok(delSql.sql.includes("AND employee_eid = $2 AND status IN ('PATEIKTA', 'TIKSLINTI')"), delSql.sql);
  assert.deepEqual(delSql.params, ["10", "emp-1"]);

  resetDb();
  onQuery(
    /SELECT employee_eid, status FROM activities WHERE id = \$1/,
    twice([{ employee_eid: "emp-1", status: "TIKSLINTI" }], [{ employee_eid: "emp-1", status: "ATMESTA" }])
  );
  onQuery(/UPDATE activities SET status = 'PATEIKTA', rejection_comment = NULL/, { rowCount: 0 });

  const re = await api(app.base, "POST", "/api/activities/10/resubmit", { headers: asRole("Darbuotojas") });
  assert.equal(re.status, 409);
  assert.match(re.body.error, /dabar: ATMESTA/);
  const upd = queryLog().find((q) => q.sql.startsWith("UPDATE activities"));
  assert.ok(upd.sql.includes("AND employee_eid = $2 AND status = 'TIKSLINTI'"), upd.sql);
  assert.deepEqual(upd.params, ["10", "emp-1"]);
});







// -----------------------------------------------------------
// theme/subtheme pairing — every writer
// -----------------------------------------------------------
//
// Each id passes its own FK, but the subtheme must belong to
// the theme or the activity's score lands in the wrong
// theme's total. Create checks the given pair; the three
// PATCH routes check what they change against what the row
// keeps (COALESCE over the current row, so sending only a
// subtheme_id is checked against the stored theme). A
// mismatch → 400, and no INSERT/UPDATE.
// -----------------------------------------------------------

test("create: a subtheme of another theme → 400, no INSERT", async () => {
  employee();
  stubFullName();
  stubPair(false);

  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ theme_id: "2", subtheme_id: "1", title: "Ne ta tema", theme_code: "T2", subtheme_code: "T1.1" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: potemė nepriklauso pasirinktai temai" });

  const check = queryLog().find((q) => q.sql.startsWith("SELECT 1 FROM subthemes"));
  assert.deepEqual(check.params, [1, 2]);
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
});

test("employee edit: only a subtheme_id sent — checked against the STORED theme; mismatch → 400", async () => {
  employee();
  stubEmployeePatch();
  stubFullName();
  stubPair(false);

  const res = await api(app.base, "PATCH", "/api/activities/10", {
    form: activityForm({ subtheme_id: "9" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: potemė nepriklauso pasirinktai temai" });

  const check = queryLog().find((q) => q.sql.startsWith("SELECT 1 FROM subthemes s JOIN activities a"));
  assert.deepEqual(check.params, ["10", 9, null]);
  assert.ok(check.sql.includes("COALESCE($2::int, a.subtheme_id)") && check.sql.includes("COALESCE($3::int, a.theme_id)"));
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);
});

test("manager and committee: a mismatched reassignment → 400, no UPDATE; a matching one proceeds", async () => {
  manager();
  stubManagerPatch();
  stubPair(false);
  let res = await api(app.base, "PATCH", "/api/activities/10/manager", {
    body: { theme_id: 2, subtheme_id: 1, manager_comments: "x" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: potemė nepriklauso pasirinktai temai" });
  assert.deepEqual(queryLog().find((q) => q.sql.startsWith("SELECT 1 FROM subthemes")).params, ["10", 1, 2]);
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);

  resetDb();
  committee();
  stubCommitteePatch();
  stubPair(false);
  res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 1, theme_id: 2, subtheme_id: 1 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE activities")), false);

  resetDb();
  stubCommitteePatch();
  stubPair(true);
  res = await api(app.base, "PATCH", "/api/activities/10/committee", {
    body: { action: "score", score: 1, theme_id: 1 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(queryLog().find((q) => q.sql.startsWith("SELECT 1 FROM subthemes")).params, ["10", null, 1]);
});







// -----------------------------------------------------------
// upload — text fields without end
// -----------------------------------------------------------
//
// Every text field may hold up to 1 MiB, and multer keeps
// them all in req.body until the body ends, so their number
// is capped. A create form has six text fields; a thousand
// of them is an attack, refused before anything is written.
// -----------------------------------------------------------

test("create: a multipart body with a thousand text fields → 4xx, nothing inserted", async () => {
  employee();
  stubFullName();
  stubPair();
  onQuery(/INSERT INTO activities/, (sql, params) => [{ id: 1, employee_eid: params[0], status: "PATEIKTA" }]);

  const form = activityForm({ theme_id: "1", subtheme_id: "2", title: "Laukai" });
  for (let i = 0; i < 1000; i++) form.append(`laukas${i}`, "x".repeat(1024));
  const res = await api(app.base, "POST", "/api/activities", { form, headers: asRole("Darbuotojas") });

  assert.ok(res.status >= 400 && res.status < 500, `answered ${res.status}`);
  assert.equal(queryLog().some((q) => q.sql.includes("INSERT INTO activities")), false);
});







// -----------------------------------------------------------
// a lost race whose re-read fails
// -----------------------------------------------------------
//
// When a conditional write matches no row, five routes answer
// through answerLostRace, which reads the row again. A
// failing re-read must land in the route's catch as a JSON
// 500: a rejection that escaped it would leave the request
// unanswered (Express 4) and end the process (Node). The
// test holds the process's unhandledRejection listeners while
// the requests run.
// -----------------------------------------------------------

test("a lost race whose re-read fails → a JSON 500 on every route, not an unhandled rejection", { timeout: 40_000 }, async () => {
  const dbDown = () => {
    throw Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  };
  const reReadFails = (row) => {
    let reads = 0;
    return () => (++reads === 1 ? [row] : dbDown());
  };
  const cases = [
    {
      name: "employee edit", who: employee, method: "PATCH", url: "/api/activities/10", role: "Darbuotojas",
      form: () => activityForm({ title: "X" }),
      stub: () => {
        stubFullName();
        onQuery(/^SELECT employee_eid, status, attachment_path FROM activities/, [{ employee_eid: "emp-1", status: "PATEIKTA", attachment_path: null }]);
        onQuery(/^UPDATE activities SET/, { rowCount: 0 });
        onQuery(/^SELECT employee_eid, status FROM activities/, dbDown);
      },
    },
    {
      name: "delete", who: employee, method: "DELETE", url: "/api/activities/10", role: "Darbuotojas",
      stub: () => {
        onQuery(/^SELECT employee_eid, status FROM activities/, reReadFails({ employee_eid: "emp-1", status: "PATEIKTA" }));
        onQuery(/^DELETE FROM activities/, { rowCount: 0 });
      },
    },
    {
      name: "resubmit", who: employee, method: "POST", url: "/api/activities/10/resubmit", role: "Darbuotojas",
      stub: () => {
        onQuery(/^SELECT employee_eid, status FROM activities/, reReadFails({ employee_eid: "emp-1", status: "TIKSLINTI" }));
        onQuery(/^UPDATE activities SET/, { rowCount: 0 });
      },
    },
    {
      name: "manager verdict", who: manager, method: "PATCH", url: "/api/activities/10/manager", role: "Vadybininkas",
      body: { action: "approve" },
      stub: () => {
        onQuery(/^SELECT status FROM activities/, [{ status: "PATEIKTA" }]);
        onQuery(/^UPDATE activities SET/, { rowCount: 0 });
        onQuery(/^SELECT employee_eid, status FROM activities/, dbDown);
      },
    },
    {
      name: "committee verdict", who: committee, method: "PATCH", url: "/api/activities/10/committee", role: "Komisijos narys",
      body: { action: "score", score: 0.5 },
      stub: () => {
        onQuery(/^SELECT status FROM activities/, [{ status: "PATVIRTINTA" }]);
        onQuery(/^UPDATE activities SET/, { rowCount: 0 });
        onQuery(/^SELECT employee_eid, status FROM activities/, dbDown);
      },
    },
  ];

  const runnerListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped = [];
  process.on("unhandledRejection", (err) => escaped.push(String(err)));

  const answers = [];
  try {
    for (const c of cases) {
      resetDb();
      c.who();
      c.stub();
      const init = { method: c.method, headers: asRole(c.role), signal: AbortSignal.timeout(3000) };
      if (c.form) init.body = c.form();
      if (c.body) {
        init.body = JSON.stringify(c.body);
        init.headers = { ...init.headers, "Content-Type": "application/json" };
      }
      const res = await fetch(app.base + c.url, init).catch((err) => err);
      answers.push(`${c.name}: ${res.status ?? res}`);
    }
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of runnerListeners) process.on("unhandledRejection", listener);
  }

  assert.deepEqual(escaped, [], "no rejection may escape a handler");
  assert.deepEqual(answers, cases.map((c) => `${c.name}: 500`));
});







// -----------------------------------------------------------
// ids Postgres cannot take
// -----------------------------------------------------------
//
// Postgres refuses "abc" or "1.5" as invalid integer syntax
// and 2147483648 as out of range for int4, which would
// surface as a 500 with a stack trace. Such an id names
// nothing: a 404 or a 400, without a query, is the answer —
// for an :id in the URL and for a theme_id in a create form.
// The fake database fails exactly where Postgres would.
// -----------------------------------------------------------

test("an id that is not an int4 → 404 or 400, never 500", async () => {
  const int4 = (value) => {
    const text = String(value);
    if (!/^-?\d+$/.test(text)) {
      throw Object.assign(new Error(`invalid input syntax for type integer: "${text}"`), { code: "22P02" });
    }
    if (Math.abs(Number(text)) > 2147483647) {
      throw Object.assign(new Error(`value "${text}" is out of range for type integer`), { code: "22003" });
    }
  };
  const gate = (sql, params) => {
    int4(params[0]);
    return [];
  };
  const allInt4 = (sql, params) => {
    params.forEach(int4);
    return [];
  };

  for (const c of [
    { who: employee, method: "DELETE", url: "/api/activities/abc", role: "Darbuotojas", gate: /^SELECT employee_eid, status FROM activities WHERE id = \$1/ },
    { who: employee, method: "POST", url: "/api/activities/2147483648/resubmit", role: "Darbuotojas", gate: /^SELECT employee_eid, status FROM activities WHERE id = \$1/ },
    { who: manager, method: "PATCH", url: "/api/activities/abc/manager", role: "Vadybininkas", body: { action: "approve" }, gate: /^SELECT status FROM activities WHERE id = \$1/ },
    { who: committee, method: "PATCH", url: "/api/activities/2147483648/committee", role: "Komisijos narys", body: { action: "score", score: 0.5 }, gate: /^SELECT status FROM activities WHERE id = \$1/ },
    { who: employee, method: "GET", url: "/api/activities/1.5/attachment", role: "Darbuotojas", gate: /^SELECT attachment_path, attachment_original_name, employee_eid FROM activities WHERE id = \$1/ },
  ]) {
    resetDb();
    c.who();
    onQuery(c.gate, gate);
    const res = await api(app.base, c.method, c.url, { body: c.body, headers: asRole(c.role) });
    assert.ok(res.status === 404 || res.status === 400, `${c.method} ${c.url} answered ${res.status}`);
  }

  resetDb();
  employee();
  stubFullName();
  onQuery(/^SELECT 1 FROM subthemes WHERE id = \$1 AND theme_id = \$2/, allInt4);
  const res = await api(app.base, "POST", "/api/activities", {
    form: activityForm({ theme_id: "3000000000", subtheme_id: "2", title: "Per didelis" }),
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 400, `a theme_id out of int4 range answered ${res.status}`);
});







// -----------------------------------------------------------
// upload — the file check itself fails
// -----------------------------------------------------------
//
// The magic-byte check opens the stored file synchronously
// inside multer's completion callback, where a throw would
// escape every handler and end the process. A filesystem
// error there — out of file descriptors, a permission
// problem — is answered as a server error instead, with the
// unchecked file removed. The test fails openSync for the
// uploads directory only, and holds the process's
// uncaughtException listeners while the request runs.
// -----------------------------------------------------------

test("a filesystem error in the magic-byte check → an answer and no file left, not a process crash", { timeout: 10_000 }, async (t) => {
  employee();
  stubFullName();
  const before = snapshotUploads();
  const realOpenSync = fs.openSync;
  t.mock.method(fs, "openSync", (file, ...rest) => {
    if (String(file).startsWith(uploadDir)) {
      throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
    }
    return realOpenSync(file, ...rest);
  });

  const runnerListeners = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  const escaped = [];
  process.on("uncaughtException", (err) => escaped.push(String(err)));

  let res;
  try {
    res = await fetch(`${app.base}/api/activities`, {
      method: "POST",
      headers: asRole("Darbuotojas"),
      body: activityForm({ ...BASE_CREATE, file: "%PDF-1.4 ataskaita", fileName: "ataskaita.pdf", fileType: "application/pdf" }),
      signal: AbortSignal.timeout(3000),
    }).catch((err) => err);
  } finally {
    process.removeAllListeners("uncaughtException");
    for (const listener of runnerListeners) process.on("uncaughtException", listener);
  }

  await new Promise((r) => setTimeout(r, 100));
  const left = [...snapshotUploads()].filter((f) => !before.has(f));
  for (const f of left) createdFiles.add(f);

  assert.deepEqual(escaped, [], "nothing may throw outside the request");
  assert.equal(typeof res.status, "number", `no answer — ${res}`);
  assert.deepEqual(left, [], "the unchecked file must not stay on disk");
});







// -----------------------------------------------------------
// upload — the client gives up halfway
// -----------------------------------------------------------
//
// A browser that is closed, or a connection that drops, in
// the middle of an upload must not leave the half-written
// file in uploads/ — nothing ever sweeps that directory, so
// every such file would stay there for good. The request is
// sent by hand: a text field, then the start of a file, then
// the socket is destroyed.
// -----------------------------------------------------------

test("an upload the client aborts halfway leaves no partial file", { timeout: 10_000 }, async () => {
  employee();
  stubFullName();
  const before = snapshotUploads();

  const boundary = "veiklos-nutraukta";
  const head = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="theme_code"',
    "",
    "T1",
    `--${boundary}`,
    'Content-Disposition: form-data; name="attachment"; filename="pusiau.txt"',
    "Content-Type: text/plain",
    "",
    "",
  ].join("\r\n");
  const { hostname, port } = new URL(app.base);
  const req = http.request({
    host: hostname,
    port,
    method: "POST",
    path: "/api/activities",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(head.length + 4 * 1024 * 1024),
      "X-Active-Role": "Darbuotojas",
    },
  });
  req.on("error", () => {});
  req.write(head);
  req.write("x".repeat(256 * 1024));
  await new Promise((r) => setTimeout(r, 300));
  req.destroy();
  await new Promise((r) => setTimeout(r, 500));

  const left = [...snapshotUploads()].filter((f) => !before.has(f));
  for (const f of left) createdFiles.add(f);
  assert.deepEqual(left, [], "an aborted upload must not stay on disk");
});







// -----------------------------------------------------------
// a sign-in without a name
// -----------------------------------------------------------
//
// VU SSO may release no first or last name, which leaves
// users.full_name empty. Every list a manager or the
// committee reads, and both verdict answers, name the
// employee by email then rather than leaving the cell blank.
// -----------------------------------------------------------

test("lists and verdict answers name the employee by email when the name is missing", async () => {
  const namedByEmail = (sql) => sql.includes("COALESCE(NULLIF(u.full_name, ''), u.email) AS full_name");

  for (const [who, role, path] of [
    [manager, "Vadybininkas", "/api/activities/all"],
    [manager, "Vadybininkas", "/api/activities/pending"],
    [committee, "Komisijos narys", "/api/activities/committee"],
    [committee, "Komisijos narys", "/api/activities/evaluated"],
  ]) {
    resetDb();
    who();
    onQuery(/FROM activities a JOIN users u/, []);
    const res = await api(app.base, "GET", path, { headers: asRole(role) });
    assert.equal(res.status, 200, path);
    assert.ok(namedByEmail(queryLog()[0].sql), `${path}: ${queryLog()[0].sql}`);
  }

  resetDb();
  manager();
  stubManagerPatch();
  await api(app.base, "PATCH", "/api/activities/10/manager", { body: { action: "approve" }, headers: asRole("Vadybininkas") });
  assert.ok(namedByEmail(queryLog().at(-1).sql), "the manager verdict's answer");

  resetDb();
  committee();
  stubCommitteePatch();
  await api(app.base, "PATCH", "/api/activities/10/committee", { body: { action: "score", score: 0.5 }, headers: asRole("Komisijos narys") });
  assert.ok(namedByEmail(queryLog().at(-1).sql), "the committee verdict's answer");
});







// -----------------------------------------------------------
// codes in reading order
// -----------------------------------------------------------
//
// Postgres sorts codes as text: "6.10." before "6.2.". The
// calculate page's two feeds are shown in the order they
// arrive, so they must arrive in code order — themes, then
// subthemes within a theme. The live theme codes are a
// family name and a section number, and two families number
// their sections alike: the text decides first, so a family's
// themes, and the subthemes under them, stay together.
// -----------------------------------------------------------

test("theme totals and an employee's subthemes come in numeric code order", async () => {
  committee();
  onQuery(/LEFT JOIN activities a/, [
    { theme_id: 1, theme_code: "6.1.", theme_title: "A", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 10, theme_code: "6.10.", theme_title: "J", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 2, theme_code: "6.2.", theme_title: "B", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
  ]);
  let res = await api(app.base, "GET", "/api/activities/evaluated/theme-totals", { headers: asRole("Komisijos narys") });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.theme_code), ["6.1.", "6.2.", "6.10."]);

  resetDb();
  onQuery(/COALESCE\(SUM\(a\.score\), 0\) AS total_score/, [
    { theme_id: 10, theme_code: "6.10.", subtheme_id: 101, subtheme_code: "6.10.1." },
    { theme_id: 2, theme_code: "6.2.", subtheme_id: 210, subtheme_code: "6.2.10." },
    { theme_id: 2, theme_code: "6.2.", subtheme_id: 22, subtheme_code: "6.2.2." },
  ]);
  res = await api(app.base, "GET", "/api/activities/evaluated/employee/emp-1/subthemes", { headers: asRole("Komisijos narys") });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.subtheme_code), ["6.2.2.", "6.2.10.", "6.10.1."]);
});

test("the live codes: theme totals and an employee's subthemes keep each family together", async () => {
  committee();
  onQuery(/LEFT JOIN activities a/, [
    { theme_id: 1, theme_code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.", theme_title: "A", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 2, theme_code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.", theme_title: "B", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 3, theme_code: "STUDIJŲ KOKYBĖ 6.1.", theme_title: "C", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 5, theme_code: "STUDIJŲ KOKYBĖ 6.10.", theme_title: "E", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
    { theme_id: 4, theme_code: "STUDIJŲ KOKYBĖ 6.2.", theme_title: "D", theme_total_sum: "0", theme_pointvalue: null, total_score: "0" },
  ]);
  let res = await api(app.base, "GET", "/api/activities/evaluated/theme-totals", { headers: asRole("Komisijos narys") });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.theme_id), [1, 2, 3, 4, 5]);

  resetDb();
  onQuery(/COALESCE\(SUM\(a\.score\), 0\) AS total_score/, [
    { theme_id: 1, theme_code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.", subtheme_id: 11, subtheme_code: "6.1.1." },
    { theme_id: 1, theme_code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.", subtheme_id: 12, subtheme_code: "6.1.2." },
    { theme_id: 2, theme_code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.", subtheme_id: 21, subtheme_code: "6.2.1." },
    { theme_id: 3, theme_code: "STUDIJŲ KOKYBĖ 6.1.", subtheme_id: 31, subtheme_code: "6.1.1." },
  ].reverse());
  res = await api(app.base, "GET", "/api/activities/evaluated/employee/emp-1/subthemes", { headers: asRole("Komisijos narys") });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.subtheme_id), [11, 12, 21, 31]);
});
