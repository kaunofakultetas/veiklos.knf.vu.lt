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
//  and an outside mousedown shutting it. Pinned as expected
//  failures, the known bugs: the list stays open when Tab
//  takes the focus out of it, and CommentModal's backdrop
//  closes the prompt while its confirm is in flight and when
//  a drag that began inside the dialog ends on it.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSelect, ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_BIG, CommentModal } from "@/components/appCommon.jsx";


const OPTIONS = [
  { id: 1, code: "6.1.", title: "Studijų kokybė" },
  { id: 2, code: "6.2.", title: "Mokslas" },
];
const label = (o) => `${o.code} — ${o.title}`;

// The activity a CommentModal names, and the prompt mounted
// with the manager's deny wording around the callbacks a test
// passes; it hands back the user-event session, the textarea
// and the backdrop
const ACTIVITY = { full_name: "Ona Onaitė", title: "Konferencijos pranešimas" };
function renderPrompt({ onConfirm = vi.fn(), onClose = vi.fn() } = {}) {
  const user = userEvent.setup();
  render(
    <CommentModal
      activity={ACTIVITY}
      title="Atmesti veiklą"
      label="Atmetimo komentaras"
      placeholder="Paaiškinkite, kodėl veikla atmetama"
      initialComment=""
      confirmLabel="Patvirtinti atmetimą"
      busyLabel="Atmetama…"
      emptyMessage="Klaida: Atmetimui būtinas komentaras."
      onConfirm={onConfirm}
      onClose={onClose}
      onMessage={() => {}}
    />
  );
  return {
    user,
    comment: screen.getByLabelText("Atmetimo komentaras"),
    backdrop: document.querySelector(".employee-modal-backdrop"),
  };
}







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







// -----------------------------------------------------------
// BUG — AppSelect stays open after Tab
// -----------------------------------------------------------
//
// The list shuts on a pick, on Escape, on the trigger and on
// a mousedown outside, but not when the focus leaves it: a
// keyboard user who tabs on past the options leaves it open
// over the form, the trigger still announcing itself
// expanded. Focus leaving the component should shut the list
// the way an outside mousedown does. A known bug, pinned as
// an expected failure until it is fixed.
// -----------------------------------------------------------

test.fails("BUG: AppSelect: tabbing out of the open list shuts it", async () => {
  const user = userEvent.setup();
  render(
    <>
      <AppSelect value="" onChange={() => {}} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />
      <button type="button">Toliau</button>
    </>
  );
  const trigger = screen.getByRole("button", { name: /Pasirinkite temą/ });
  const next = screen.getByRole("button", { name: "Toliau" });

  await user.tab();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("group")).toBeInTheDocument();

  // Through the options and on to the next control
  for (let i = 0; i <= OPTIONS.length && document.activeElement !== next; i++) await user.tab();
  expect(next).toHaveFocus();
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});







// -----------------------------------------------------------
// AppSelect — named by a caption
// -----------------------------------------------------------
//
// With labelledBy the trigger is named by the caption it
// points to, then the value it shows — the listbox-button
// pattern, so a screen reader says which field and what is
// in it — whatever element the caption is. The chevron is
// decoration and stays out of the name.
// -----------------------------------------------------------

test("AppSelect: labelledBy names the trigger by the caption, then the value", () => {
  render(
    <>
      <div id="theme-caption">Tema</div>
      <AppSelect labelledBy="theme-caption" value={2} onChange={() => {}} options={OPTIONS} getLabel={label} placeholder="Pasirinkite temą" />
    </>
  );
  const trigger = screen.getByLabelText("Tema");
  expect(trigger).toHaveClass("app-select-trigger");
  expect(trigger).toHaveAccessibleName("Tema 6.2. — Mokslas");
});







// -----------------------------------------------------------
// BUG — CommentModal closes mid-confirm
// -----------------------------------------------------------
//
// While the confirm is in flight only the two buttons are
// disabled: a click on the backdrop still closes the prompt,
// and when the page then refuses the verdict, the comment the
// user typed has gone with it. The prompt should stay open
// until its confirm ends, closing on success as it does now.
// A known bug, pinned as an expected failure until it is
// fixed.
// -----------------------------------------------------------

test.fails("BUG: CommentModal: a backdrop click while the confirm is in flight leaves the prompt open", async () => {
  let answer;
  const onConfirm = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
  const onClose = vi.fn().mockName("onClose");
  const { user, comment, backdrop } = renderPrompt({ onConfirm, onClose });

  await user.type(comment, "Trūksta dokumentų");
  await user.click(screen.getByRole("button", { name: "Patvirtinti atmetimą" }));
  expect(onConfirm).toHaveBeenCalledWith("Trūksta dokumentų");
  expect(screen.getByRole("button", { name: "Atmetama…" })).toBeDisabled();

  await user.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();

  answer();
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});







// -----------------------------------------------------------
// BUG — CommentModal closes on a drag out of the dialog
// -----------------------------------------------------------
//
// A text selection that starts in the textarea and is let go
// over the backdrop ends in a click on their common ancestor,
// the backdrop, which closes the prompt without checking that
// the press began on it — the typed comment is lost to a
// sloppy selection. Only a press and release on the backdrop
// itself should close the prompt. A known bug, pinned as an
// expected failure until it is fixed.
// -----------------------------------------------------------

test.fails("BUG: CommentModal: a drag from the textarea onto the backdrop keeps the prompt open; a click on the backdrop closes it", async () => {
  const onClose = vi.fn().mockName("onClose");
  const { user, comment, backdrop } = renderPrompt({ onClose });

  await user.type(comment, "Trūksta dokumentų");
  await user.pointer([{ keys: "[MouseLeft>]", target: comment }, { target: backdrop }, { keys: "[/MouseLeft]" }]);
  expect(onClose).not.toHaveBeenCalled();
  expect(comment).toHaveValue("Trūksta dokumentų");

  await user.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
});
