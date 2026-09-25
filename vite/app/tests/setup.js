// -----------------------------------------------------------
//  [*] Test setup — jsdom matchers and a clean slate per test
//
//  Loaded by vitest before every test file (vite.config.js
//  → test.setupFiles): the jest-dom matchers on expect,
//  Testing Library's cleanup after each test, localStorage
//  wiped, and window.fetch replaced by the scripted fake from
//  helpers/fakeFetch.js so no test can reach a network.
// -----------------------------------------------------------

import { afterEach, beforeEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { installFakeFetch, resetFakeFetch } from "./helpers/fakeFetch.js";


expect.extend(matchers);

beforeEach(() => {
  localStorage.clear();
  resetFakeFetch();
  installFakeFetch();
  // Pages call window.alert / window.confirm; jsdom has no
  // implementation, so each test gets a fresh spy
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  // restoreAllMocks puts spied originals back but leaves
  // vi.fn() call logs (module mocks) alone; clear those too
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
