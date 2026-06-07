import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';
import { BASE_URL } from '../services/api/core.js';

const SocketContext = createContext(null);

// Electron prod (loadFile): window.location.origin = 'null' — use explicit BASE_URL
// Dev (Vite proxy): window.location.origin = http://localhost:5173 → proxy → 3001
const SOCKET_URL = BASE_URL;

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  // event → Set<callback>
  const listenersRef = useRef(new Map());

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('pos_token');
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('connect_error', () => setIsConnected(false));

    // Kayıtlı dinleyicileri yeniden bağla (reconnect sonrası)
    for (const [event, cbs] of listenersRef.current.entries()) {
      for (const cb of cbs) socket.on(event, cb);
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Event dinleyici ekle. Dönen fonksiyonu useEffect cleanup'ında çağır.
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} unsubscribe
   */
  const subscribe = useCallback((event, callback) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event).add(callback);
    socketRef.current?.on(event, callback);

    return () => {
      listenersRef.current.get(event)?.delete(callback);
      socketRef.current?.off(event, callback);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ isConnected, subscribe }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
