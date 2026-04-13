import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { IncomingCallProvider } from './context/IncomingCallContext.jsx';
import { applyDisplaySettings, loadStoredDisplaySettings } from './utils/displayTheme.js';
import './styles/global.css';

applyDisplaySettings(loadStoredDisplaySettings());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
