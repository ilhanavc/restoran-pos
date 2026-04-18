import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/browser';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { IncomingCallProvider } from './context/IncomingCallContext.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { applyDisplaySettings, loadStoredDisplaySettings } from './utils/displayTheme.js';
import './styles/global.css';

applyDisplaySettings(loadStoredDisplaySettings());

const _sentryDsn = window.electronAPI?.sentryDsn;
if (_sentryDsn) {
  try {
    Sentry.init({
      dsn: _sentryDsn,
      release: undefined,
      environment: import.meta.env.DEV ? 'development' : 'production',
      beforeSend(event) {
        delete event.user;
        return event;
      },
    });
  } catch { /* must never break renderer startup */ }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <SocketProvider>
            <ToastProvider>
              <IncomingCallProvider>
                <App />
              </IncomingCallProvider>
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
