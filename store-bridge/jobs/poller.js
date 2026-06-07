import { sendEthernetPrint } from '../printers/ethernetPrinter.js';
import { sendUsbPrint } from '../printers/usbPrinter.js';
import { payloadToEscPosBuffer } from '../printers/renderers.js';

function classifyPrintError(err) {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  if (code === 'api_timeout') return 'api_error';
  if (msg.includes('timeout') || code.includes('timeout') || code === 'etimedout') return 'network_timeout';
  if (msg.includes('usb') || msg.includes('winspool') || msg.includes('powershell')) return 'usb_print_failed';
  if (msg.includes('json') || msg.includes('render')) return 'render_failed';
  return 'unknown_error';
}

export function startJobPoller({ api, cfg, log = console }) {
  let timer = null;
  let running = false;

  async function processOne() {
    if (running) return;
    running = true;
    try {
      const { jobs = [] } = await api.listPendingJobs(15);
      if (!jobs.length) return;

      for (const job of jobs) {
        let activeId = job.id;
        try {
          let claimed;
          try {
            claimed = await api.claimJob(job.id);
          } catch (e) {
            if (e?.status === 409) continue;
            throw e;
          }

          const j = claimed.job || job;
          activeId = j.id;

          if (!j.printer_id) {
            await api.updateJob(activeId, { status: 'failed', error_message: 'printer_id yok', error_code: 'printer_missing' });
            continue;
          }

          const prRes = await api.getPrinter(j.printer_id);
          const printer = prRes.printer;
          if (!printer) {
            await api.updateJob(activeId, { status: 'failed', error_message: 'Yazıcı bulunamadı', error_code: 'printer_missing' });
            continue;
          }
          if (!printer.is_active) {
            await api.updateJob(activeId, { status: 'failed', error_message: 'Yazıcı pasif', error_code: 'printer_inactive' });
            continue;
          }

          const conn = (printer.connection_type || 'network').toLowerCase();

          if (conn !== 'network' && conn !== 'usb') {
            await api.updateJob(activeId, {
              status: 'failed',
              error_message: `Desteklenmeyen bağlantı türü: connection=${conn} (network veya usb gerekli)`,
              error_code: 'unsupported_connection',
            });
            continue;
          }

          if (conn === 'network' && !printer.ip_address) {
            await api.updateJob(activeId, {
              status: 'failed',
              error_message: 'Ağ yazıcısı için ip_address gerekli',
              error_code: 'printer_config_missing',
            });
            continue;
          }

          if (conn === 'usb' && !printer.printer_name) {
            await api.updateJob(activeId, {
              status: 'failed',
              error_message: 'USB yazıcısı için printer_name (Windows yazıcı adı) gerekli',
              error_code: 'printer_config_missing',
            });
            continue;
          }

          const rawOpts = printer.print_options;
          const printerOptions = rawOpts
            ? (typeof rawOpts === 'string' ? JSON.parse(rawOpts) : rawOpts)
            : {};
          const buffer = payloadToEscPosBuffer(j, printerOptions);

          if (cfg.dryRun) {
            log.log(`[bridge] DRY_RUN job=${activeId} conn=${conn} bytes=${buffer.length}`);
            await api.updateJob(activeId, { status: 'printed' });
            continue;
          }

          if (conn === 'usb') {
            await sendUsbPrint({
              printerName: printer.printer_name,
              buffer,
              timeoutMs: cfg.socketTimeoutMs,
            });
          } else {
            await sendEthernetPrint({
              host: printer.ip_address,
              port: printer.port || 9100,
              buffer,
              timeoutMs: cfg.socketTimeoutMs,
            });
          }

          await api.updateJob(activeId, { status: 'printed' });
        } catch (e) {
          const msg = e?.message || String(e);
          log.error('[bridge] job error', e);
          try {
            await api.updateJob(activeId, {
              status: 'failed',
              error_message: msg.slice(0, 500),
              error_code: classifyPrintError(e),
            });
          } catch (e2) {
            log.error('[bridge] failed to report failure', e2);
          }
        }
      }
    } catch (e) {
      log.error('[bridge] poll error', e);
    } finally {
      running = false;
    }
  }

  async function tick() {
    await processOne();
    timer = setTimeout(tick, cfg.pollIntervalMs);
  }

  tick();

  return () => {
    if (timer) clearTimeout(timer);
  };
}
