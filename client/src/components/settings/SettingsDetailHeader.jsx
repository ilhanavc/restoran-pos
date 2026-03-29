import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SettingsDetailHeader({ title, onBack }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (onBack) onBack();
    else navigate('/settings');
  };

  return (
    <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={goBack}
        aria-label="Ayarlar ana ekranına dön"
      >
        <ArrowLeft size={18} />
        Geri
      </button>
      <h1 className="page-title" style={{ margin: 0 }}>{title}</h1>
    </div>
  );
}
