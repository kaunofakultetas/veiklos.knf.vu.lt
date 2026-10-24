// -----------------------------------------------------------
//  [*] Components — hooks the pages' dialogs and rows share
//
//  Three behaviours every page with dialogs or row actions
//  needs alike: a backdrop that closes its dialog only on a
//  press and release of its own and never while a request is
//  in flight, dialog semantics with the focus moved in and
//  given back, and busy flags kept per row, so one row's
//  request never re-enables another's. A module of hooks
//  alone, so that appCommon.jsx keeps exporting components
//  and constants only, as Vite's fast refresh needs.
//
//  Split into:
//
//    useBackdropClose — a dialog backdrop's close handlers
//    useModalDialog   — a dialog box's focus handling
//    useBusyIds       — busy flags kept per row id
// -----------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";







// -----------------------------------------------------------
// useBackdropClose
// -----------------------------------------------------------
//
// The mousedown and click handlers for a dialog's backdrop.
// A click closes the dialog only when the press did not
// start inside the box: a text selection dragged out of a
// field and let go over the backdrop ends in a click on the
// backdrop, their common ancestor, and must not throw the
// draft away. While `busy` (a request in flight, when the
// dialog's own buttons are disabled too) the backdrop closes
// nothing, so a late answer always finds its dialog open.
//
// Used by:
//   - components/appCommon.jsx — CommentModal
//   - employee/myActivities.jsx, manager/review.jsx,
//     committee/evaluate.jsx, committee/results.jsx — their
//     dialogs' backdrops
// -----------------------------------------------------------

export function useBackdropClose(onClose, busy) {
  const pressedInside = useRef(false);
  return {
    onMouseDown: (e) => {
      pressedInside.current = e.target !== e.currentTarget;
    },
    onClick: (e) => {
      const fromInside = pressedInside.current;
      pressedInside.current = false;
      if (busy || fromInside || e.target !== e.currentTarget) return;
      onClose();
    },
  };
}







// -----------------------------------------------------------
// useModalDialog
// -----------------------------------------------------------
//
// Focus handling for a dialog box: the returned ref goes on
// the box (which the page marks role="dialog", aria-modal and
// tabIndex -1, named by its title), the focus moves into the
// box when it mounts and goes back to whatever had it — the
// button that opened it — when it unmounts, unless that
// element is gone by then. The opener is noted while the
// dialog first renders: when one dialog replaces another,
// the old one's cleanup has moved the focus by the time the
// new one's effect runs.
//
// Used by:
//   - components/appCommon.jsx — CommentModal
//   - employee/myActivities.jsx — the activity dialog
//   - manager/review.jsx — the review dialog
//   - committee/evaluate.jsx, committee/results.jsx — the
//     scoring and re-scoring dialogs
// -----------------------------------------------------------

export function useModalDialog() {
  const ref = useRef(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    ref.current?.focus();
    return () => {
      if (opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, [opener]);
  return ref;
}







// -----------------------------------------------------------
// useBusyIds
// -----------------------------------------------------------
//
// Busy flags for row actions, one per row id: start marks a
// row busy, stop clears that row alone and isBusy asks about
// one row. With a single shared id, a second row's action
// re-enabled the first row's buttons mid-request, and the
// first answer re-enabled the second's.
//
// Used by:
//   - manager/review.jsx — the verdict buttons
//   - employee/myActivities.jsx — delete, resubmit and the
//     attachment downloads
//   - committee/limits.jsx — the per-row save buttons
// -----------------------------------------------------------

export function useBusyIds() {
  const [ids, setIds] = useState(() => new Set());
  const start = useCallback((id) => setIds((prev) => new Set(prev).add(id)), []);
  const stop = useCallback((id) => setIds((prev) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  }), []);
  const isBusy = useCallback((id) => ids.has(id), [ids]);
  return { isBusy, start, stop };
}
