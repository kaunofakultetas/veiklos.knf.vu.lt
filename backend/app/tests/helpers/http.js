// -----------------------------------------------------------
//  [*] Test helpers — express harness + request shorthand
//
//  Boots one router in a throwaway express app on an
//  ephemeral port, mirroring how index.js mounts it
//  (express.json() applied app-wide). The router module is
//  imported DYNAMICALLY here so the module mocks registered
//  by authMock.js / mailMock.js are already in place.
// -----------------------------------------------------------

import { once } from "node:events";







// -----------------------------------------------------------
// startRouter
// -----------------------------------------------------------
//
// const app = await startRouter("/api/themes",
//   new URL("../src/routes/themes.js", import.meta.url).href);
// ... await app.close();
//
// Returns { base, close } — base is http://127.0.0.1:<port>.
// `pre` is an optional middleware list applied at the mount,
// for routers index.js guards at mount time (user-roles).
//
// Used by:
//   - every *.routes.test.js file
// -----------------------------------------------------------

export async function startRouter(mountPath, routerHref, pre = []) {
  const express = (await import("express")).default;
  const { default: router } = await import(routerHref);

  const app = express();
  app.use(express.json());
  app.use(mountPath, ...pre, router);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}







// -----------------------------------------------------------
// api
// -----------------------------------------------------------
//
// api(base, "POST", "/api/roles/assign", { body, headers })
// api(base, "POST", "/api/activities", { form, headers })
//
// `body` is JSON-encoded; `form` is a FormData for multipart.
// Returns { status, body (parsed JSON or null), text,
// headers }.
//
// Used by:
//   - every *.routes.test.js file, index.test.js
// -----------------------------------------------------------

export async function api(base, method, path, { body, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }

  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body (express default error pages, downloads)
  }

  return { status: res.status, body: json, text, headers: res.headers };
}
