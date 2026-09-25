// -----------------------------------------------------------
//  [*] Regression — components/appCommon.jsx
//
//  The shared attachment constants the forms enforce
//  client-side, and AppSelect: placeholder, open/close,
//  picking an option hands getValue(option) to onChange, the
//  selected option's label shows on the trigger, a disabled
//  select stays shut — and the keyboard/ARIA layer: the
//  trigger's aria-haspopup / aria-expanded and forwarded id,
//  the list as a labelled group with the selected option
//  pressed, arrow keys entering and walking the list, Escape
//  and an outside mousedown shutting it.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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







// -----------------------------------------------------------
// AppSelect — keyboard and ARIA
// -----------------------------------------------------------
//
// The trigger is a popup button (aria-haspopup="listbox",
// aria-expanded following the list) that a page label can
// address through the forwarded id; the list is a group named
// by `label` (or the placeholder) whose selected option is
// aria-pressed. ArrowDown/ArrowUp on the trigger enter the
// list at its first/last option and walk it (clamped at the
// ends), Enter picks, Escape shuts the list and refocuses the
// trigger, and a mousedown outside shuts it — through a
// document listener that exists only while the list is open.
// -----------------------------------------------------------

test("AppSelect: popup button with a forwarded id, the list a labelled group, the selected option pressed", async () => {
  const user = userEvent.setup();
  render(
    <>
      <label htmlFor="theme-select">Tema</label>
      <AppSelect id="theme-select" label="Temų sąrašas" value={2} onChange={() => {}} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />
    </>
  );
  const trigger = screen.getByLabelText("Tema");
  expect(trigger).toHaveClass("app-select-trigger");
  expect(trigger).toHaveAttribute("id", "theme-select");
  expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group")).not.toBeInTheDocument();

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const list = screen.getByRole("group", { name: "Temų sąrašas" });
  expect(list).toHaveClass("app-select-dropdown");
  expect(within(list).getByRole("button", { name: "6.2. — Mokslas" })).toHaveAttribute("aria-pressed", "true");
  expect(within(list).getByRole("button", { name: "6.1. — Studijų kokybė" })).toHaveAttribute("aria-pressed", "false");

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group")).not.toBeInTheDocument();

  // Without a label the group is named after the placeholder
  render(<AppSelect value="" onChange={() => {}} options={OPTIONS} getLabel={label} placeholder="Pasirinkite potemę" />);
  await user.click(screen.getByRole("button", { name: /Pasirinkite potemę/ }));
  expect(screen.getByRole("group", { name: "Pasirinkite potemę" })).toBeInTheDocument();
});

test("AppSelect: arrows enter and walk the list, Enter picks, Escape shuts it and refocuses the trigger", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AppSelect value="" onChange={onChange} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />);
  const trigger = screen.getByRole("button", { name: /Pasirinkite temą/ });
  const first = () => screen.getByRole("button", { name: "6.1. — Studijų kokybė" });
  const second = () => screen.getByRole("button", { name: "6.2. — Mokslas" });

  await user.tab();
  expect(trigger).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(first()).toHaveFocus();

  await user.keyboard("{ArrowDown}");
  expect(second()).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(second()).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(first()).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(first()).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  expect(onChange).not.toHaveBeenCalled();

  // ArrowUp on the shut trigger enters at the last option
  await user.keyboard("{ArrowUp}");
  expect(second()).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledWith("2");
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("AppSelect: a mousedown outside shuts the list; the document listener exists only while it is open", async () => {
  const user = userEvent.setup();
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const mousedowns = (spy) => spy.mock.calls.filter(([type]) => type === "mousedown");
  const { unmount } = render(<AppSelect value="" onChange={() => {}} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />);
  const trigger = screen.getByRole("button", { name: /Pasirinkite temą/ });
  expect(mousedowns(added)).toHaveLength(0);

  await user.click(trigger);
  expect(mousedowns(added)).toHaveLength(1);
  fireEvent.mouseDown(screen.getByRole("button", { name: "6.2. — Mokslas" }));
  expect(screen.getByRole("group")).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(mousedowns(removed)).toHaveLength(1);
  expect(mousedowns(removed)[0][1]).toBe(mousedowns(added)[0][1]);

  await user.click(trigger);
  expect(mousedowns(added)).toHaveLength(2);
  unmount();
  expect(mousedowns(removed)).toHaveLength(2);
});
