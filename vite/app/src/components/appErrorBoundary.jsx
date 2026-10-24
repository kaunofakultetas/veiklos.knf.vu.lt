// -----------------------------------------------------------
//  [*] AppErrorBoundary — the last line before a blank page
//
//  React drops the whole tree when a render throws; without a
//  boundary the user is left with an empty window and no
//  hint. This wraps the route tree: a throw anywhere below it
//  renders a card that says so, with a way home and a reload.
//  The card lasts only as long as the address it broke on:
//  going home from it, or Back or Forward to another page,
//  renders that page again — a crash tied to one page's data
//  would otherwise come straight back with the reload. The
//  boundary itself is a class on purpose — React 19 still has
//  no hook for componentDidCatch — wrapped in a component
//  that hands it the router's location.
//
//  Split into (root component last):
//
//    Boundary         — catches the throw, shows the card
//    AppErrorBoundary — the location-aware wrapper (default)
// -----------------------------------------------------------

import { Component } from "react";
import { Link, useLocation } from "react-router-dom";







// -----------------------------------------------------------
// Boundary
// -----------------------------------------------------------
//
// Renders its children until one of them throws while
// rendering; from then on the error card, until `resetKey`
// changes — the path of the page — and the children get
// another try. The error itself goes to console.error — the
// card names no internals. The card offers "Grįžti į
// pradžią", a link home that leaves the broken page behind,
// and the reload.
//
// Used by:
//   - AppErrorBoundary (below)
// -----------------------------------------------------------

class Boundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Puslapio atvaizduoti nepavyko:", error);
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
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
            <div className="form-actions">
              <Link to="/" className="btn btn-secondary">
                Grįžti į pradžią
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Perkrauti puslapį
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}







// -----------------------------------------------------------
// AppErrorBoundary (default export)
// -----------------------------------------------------------
//
// The boundary keyed to the router's current path, so that
// leaving the page a render broke on — by the card's link,
// Back, Forward or any navigation — clears the card. It must
// sit inside the router.
//
// Used by:
//   - App.jsx — around RoutesRoot, inside BrowserRouter
// -----------------------------------------------------------

export default function AppErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
