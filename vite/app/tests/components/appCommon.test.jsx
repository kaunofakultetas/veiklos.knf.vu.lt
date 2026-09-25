// -----------------------------------------------------------
//  [*] Regression — components/appCommon.jsx
//
//  The shared attachment constants the forms enforce
//  client-side, and AppSelect: placeholder, open/close,
//  picking an option hands getValue(option) to onChange, the
//  selected option's label shows on the trigger, and a
//  disabled select stays shut.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSelect, ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_BIG } from "@/components/appCommon.jsx";


const OPTIONS = [
  { id: 1, code: "6.1.", title: "Studijų kokybė" },
  { id: 2, code: "6.2.", title: "Mokslas" },
];
const label = (o) => `${o.code} — ${o.title}`;







// -----------------------------------------------------------
// constants
// -----------------------------------------------------------
//
// The accept list, the 100 MB limit and the message are the
// backend's allowlist and limit, repeated for the browser.
// -----------------------------------------------------------

test("attachment constants match the backend's allowlist and limit", () => {
  expect(ATTACHMENT_ACCEPT.split(",")).toEqual([
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
    ".rtf", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ]);
  expect(ATTACHMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
  expect(ATTACHMENT_TOO_BIG).toBe("Klaida: priedas per didelis (iki 100 MB)");
});







// -----------------------------------------------------------
// AppSelect
// -----------------------------------------------------------
//
// Closed by default with the placeholder; the trigger opens
// the option list; an option click reports its value and
// closes the list; the trigger then shows that label.
// -----------------------------------------------------------

test("AppSelect: placeholder, open, pick → onChange(getValue), label on the trigger", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <AppSelect value="" onChange={onChange} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />
  );

  const trigger = screen.getByRole("button", { name: /Pasirinkite temą/ });
  expect(screen.queryByRole("button", { name: "6.2. — Mokslas" })).not.toBeInTheDocument();

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "6.2. — Mokslas" }));
  expect(onChange).toHaveBeenCalledWith("2");
  expect(screen.queryByRole("button", { name: "6.2. — Mokslas" })).not.toBeInTheDocument();

  rerender(<AppSelect value={2} onChange={onChange} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />);
  expect(screen.getByRole("button", { name: /6\.2\. — Mokslas/ })).toBeInTheDocument();
});

test("AppSelect: a custom getValue is honoured; disabled never opens", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AppSelect value="" onChange={onChange} options={OPTIONS} getLabel={label} getValue={(o) => o.code} />);
  await user.click(screen.getByRole("button", { name: /Pasirinkite/ }));
  await user.click(screen.getByRole("button", { name: "6.1. — Studijų kokybė" }));
  expect(onChange).toHaveBeenCalledWith("6.1.");

  render(<AppSelect value="" onChange={onChange} options={OPTIONS} getLabel={label} placeholder="Išjungta" disabled />);
  await user.click(screen.getByRole("button", { name: /Išjungta/ }));
  expect(screen.queryByRole("button", { name: "6.2. — Mokslas" })).not.toBeInTheDocument();
});
