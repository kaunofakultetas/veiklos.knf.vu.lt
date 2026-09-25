// -----------------------------------------------------------
//  [*] Test setup — jsdom matchers and a clean slate per test
//
//  Loaded by vitest before every test file (vite.config.js
//  → test.setupFiles): the jest-dom matchers on expect,
//  Testing Library's cleanup after each test, localStorage
//  wiped, and window.fetch replaced by the scripted fake from
//  helpers/fakeFetch.js so no test can reach a network. After
//  every test the API contract guard must be clean: a request
//  or answer off the contract, or a page reading a field the
//  contract does not list, fails the test that did it.
// -----------------------------------------------------------

import { afterEach, beforeEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { installFakeFetch, resetFakeFetch } from "./helpers/fakeFetch.js";
import { contractViolations, resetContractGuard } from "./helpers/contractGuard.js";


expect.extend(matchers);

beforeEach(() => {
  localStorage.clear();
  resetFakeFetch();
  resetContractGuard();
  installFakeFetch();
  // Pages call window.alert / window.confirm; jsdom has no
  // implementation, so each test gets a fresh spy
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockImplementation(() => true);
});

afterEach(() => {
  const broken = [...new Set(contractViolations())];
  cleanup();
  if (broken.length) {
    throw new Error("API contract (tests/contract/api.js) violated:\n  " + broken.join("\n  "));
  }
  // restoreAllMocks puts spied originals back but leaves
  // vi.fn() call logs (module mocks) alone; clear those too
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
