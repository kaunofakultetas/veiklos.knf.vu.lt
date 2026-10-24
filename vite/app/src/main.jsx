// -----------------------------------------------------------
//  [*] Entry — React bootstrap
//
//  Mounts the app into #root inside StrictMode. There is no
//  auth provider here: the session lives in a cookie the
//  browser sends by itself, so the pages reach the backend
//  through the plain fetch of components/api.js.
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
