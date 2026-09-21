// -----------------------------------------------------------
//  [*] Entry — React bootstrap
//
//  Mounts the app into #root inside StrictMode. Since the
//  VU SSO (SAML) migration there is no auth provider here —
//  the session lives in a cookie, so App talks to the backend
//  with plain fetch.
// -----------------------------------------------------------

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import "./components/theme.css";
import "./components/global.css";


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
