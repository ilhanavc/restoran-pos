import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api.js';

export default function PrinterPreviewPanel({ type, lineWidth, printOptions }) {
  const layout = printOptions?.layout || {};
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState(null);
  const timerRef = useRef(null);

  const previewKind = type === 'receipt' ? 'receipt' : type === 'bar' ? 'bar' : 'kitchen';
  const printOptionsSig = useMemo(() => JSON.stringify(printOptions ?? {}), [printOptions]);

  const lw = useMemo(() => {
    const n = parseInt(String(lineWidth ?? '').trim(), 10);
    if (Number.isFinite(n) && n >= 32 && n <= 42) return n;
    return 42;
  }, [lineWidth]);

  const fi = Number(layout.fontSizeItems) || 13;
  const ff = layout.fontFamily || 'Courier New, monospace';

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(true);
    setFetchErr(null);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await api.postAdminPrinterPreview({
          type: previewKind,
          line_width: lineWidth === '' || lineWidth == null ? null : lineWidth,
          print_options: printOptions,
        });
        setLines(Array.isArray(data.lines) ? data.lines : []);
      } catch (e) {
        setFetchErr(e.message || 'Önizleme yüklenemedi');
        setLines([]);
      } finally {
        setLoading(false);
      }
    }, 320);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- printOptions is captured via printOptionsSig (JSON.stringify); adding printOptions directly would cause duplicate runs
  }, [previewKind, lineWidth, printOptionsSig]);

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        className="printer-preview-paper"
        style={{
          background: '#f4f4f4',
          color: '#141414',
          border: '1px solid #bdbdbd',
          borderRadius: 6,
          padding: '14px 12px',
          maxWidth: '100%',
          width: `${lw}ch`,
          minWidth: 0,
          boxSizing: 'content-box',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Önizleme güncelleniyor…</div>
        ) : null}
        {!loading && fetchErr ? (
          <div style={{ fontSize: 13, color: 'var(--danger, #ef4444)' }}>{fetchErr}</div>
        ) : null}
        {!loading && !fetchErr ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: ff,
              fontSize: fi,
              lineHeight: 1.35,
            }}
          >
            {lines.join('\n')}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
