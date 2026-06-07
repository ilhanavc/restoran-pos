import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { IncomingCallProvider } from './context/IncomingCallContext.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { initSentry } from './services/sentry.js';
import { applyDisplaySettings, loadStoredDisplaySettings } from './utils/displayTheme.js';
import './styles/global.css';

// Sentry init her şeyden önce — render/lifecycle hatalarını da yakalayabilsin.
initSentry();

applyDisplaySettings(loadStoredDisplaySettings());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <SocketProvider>
            <ToastProvider>
              <IncomingCallProvider>
                <App />
              </IncomingCallProvider>
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
