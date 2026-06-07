import { Component } from 'react';
import { Sentry, isSentryEnabled } from '../../services/sentry.js';

/**
 * React Error Boundary — uygulamanın herhangi bir yerinde yakalanmamış
 * bir render/lifecycle hatası oluşursa beyaz ekran yerine anlamlı bir
 * geri dönüş arayüzü gösterir.
 *
 * Kullanım:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * veya belirli bir bölge için:
 *   <ErrorBoundary fallbackLabel="Sipariş ekranı">
 *     <OrderScreen />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Electron log dosyasına da düşer (stdout → userData/logs/electron-main.log)
    console.error('[ErrorBoundary] Yakalanmamış render hatası:', error, info.componentStack);
    if (isSentryEnabled()) {
      Sentry.withScope((scope) => {
        scope.setTag('source', 'ErrorBoundary');
        scope.setContext('react', { componentStack: info?.componentStack });
        Sentry.captureException(error);
      });
    }
  }

  handleReload() {
    // Önce state'i sıfırla; başarısız olursa sayfayı yenile
    this.setState({ hasError: false, error: null }, () => {
      if (this.state.hasError) window.location.reload();
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.fallbackLabel || 'Uygulama';

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
        background: 'var(--bg-primary, #1a1a2e)',
        color: 'var(--text-primary, #e0e0e0)',
        fontFamily: 'sans-serif',
        padding: 24,
        textAlign: 'center',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}>
          ⚠
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {label} beklenmeyen bir hatayla karşılaştı
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', maxWidth: 360 }}>
            Sayfayı yenileyerek tekrar deneyin. Sorun devam ederse uygulamayı kapatıp açın.
          </div>
        </div>
        <button
          onClick={this.handleReload}
          style={{
            marginTop: 8,
            padding: '10px 24px',
            background: 'var(--accent, #6c63ff)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Yenile
        </button>
        {import.meta.env.DEV && this.state.error && (
          <pre style={{
            marginTop: 16,
            padding: 12,
            background: 'rgba(255,0,0,0.1)',
            borderRadius: 8,
            fontSize: 11,
            maxWidth: 500,
            overflowX: 'auto',
            textAlign: 'left',
            color: '#ff6b6b',
          }}>
            {String(this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
