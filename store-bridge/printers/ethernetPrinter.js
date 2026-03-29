import net from 'net';

/**
 * Raw TCP (ör. port 9100) ESC/POS yazıcıya buffer gönderir.
 * @returns {Promise<void>}
 */
export function sendEthernetPrint({ host, port = 9100, buffer, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    if (!host || !String(host).trim()) {
      reject(new Error('Yazıcı IP adresi yok'));
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Yazıcı zaman aşımı (${timeoutMs} ms)`));
    }, timeoutMs);

    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    socket.connect(port, host.trim(), () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(writeErr);
          }
          return;
        }
        socket.end();
      });
    });

    socket.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}
