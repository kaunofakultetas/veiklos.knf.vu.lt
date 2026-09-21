// -----------------------------------------------------------
//  [*] Auth — MSAL configuration
//
//  Client + tenant ids for the VU Entra app registration.
//
//  DEAD CODE since the Keycloak/SAML migration: nothing
//  imports this module anymore — sign-in is a redirect to
//  /auth/saml/login and the session lives in a cookie.
//  Kept as the Microsoft-era configuration.
// -----------------------------------------------------------







// -----------------------------------------------------------
// msalConfig
// -----------------------------------------------------------
//
// Tokens are cached in localStorage so a refresh keeps the
// user signed in.
//
// Used by:
//   - main.jsx — PublicClientApplication
// -----------------------------------------------------------

export const msalConfig = {
  auth: {
    clientId: "388dcf86-f44f-4a60-bf19-5dae1245d95d",
    authority: "https://login.microsoftonline.com/82c51a82-548d-43ca-bcf9-bf4b7eb1d012",
    redirectUri: "https://localhost:5173/",
    postLogoutRedirectUri: "https://localhost:5173/"
  },
  cache: {
    cacheLocation: "localStorage", // signed in on refresh
    storeAuthStateInCookie: false
  }
}







// -----------------------------------------------------------
// loginRequest
// -----------------------------------------------------------
//
// The scopes asked for at login and on every silent token
// refresh — identity only, no API scopes.
//
// Used by:
//   - App.jsx, components/appHeader.jsx, and every page's
//     useIdToken copy
// -----------------------------------------------------------

export const loginRequest = {
  scopes: ["openid", "profile", "email"] // SSO
}
