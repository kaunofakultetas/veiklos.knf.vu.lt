// -----------------------------------------------------------
//  [*] AppErrorBoundary — the last line before a blank page
//
//  React drops the whole tree when a render throws; without a
//  boundary the user is left with an empty window and no
//  hint. This wraps the route tree: a throw anywhere below it
//  renders a card that says so and offers a reload instead.
//  A class on purpose — React 19 still has no hook for
//  componentDidCatch.
//
//  Used by:
//    - App.jsx — around RoutesRoot
// -----------------------------------------------------------

import { Component } from "react";







// -----------------------------------------------------------
// AppErrorBoundary (default export)
// -----------------------------------------------------------
//
// Renders its children until one of them throws while
// rendering; from then on the error card, until the reload.
// The error itself goes to console.error — the card names no
// internals.
//
// Used by:
//   - App.jsx — around RoutesRoot
// -----------------------------------------------------------

export default class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Puslapio atvaizduoti nepavyko:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="page page-centered">
        <div className="card">
          <div className="card-body">
            <h2>Įvyko netikėta klaida.</h2>
            <p>
              Puslapio nepavyko atvaizduoti. Perkraukite puslapį; jei klaida kartojasi,
              parašykite adresu <a href="mailto:info@knf.vu.lt">info@knf.vu.lt</a>.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Perkrauti puslapį
            </button>
          </div>
        </div>
      </div>
    );
  }
}
