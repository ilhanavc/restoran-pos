import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SettingsDetailHeader({ title, onBack }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (onBack) onBack();
    else navigate('/settings');
  };

  return (
    <div className="page-header page-header-with-back">
      <div className="page-header-back-row">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={goBack}
          aria-label="Ayarlar ana ekranına dön"
        >
          <ArrowLeft size={18} />
          Geri
        </button>
      </div>
      <div className="page-header-main page-title-line">
        <h1 className="page-title">{title}</h1>
      </div>
    </div>
  );
}
