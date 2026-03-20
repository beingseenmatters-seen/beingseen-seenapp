import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n';

export default function Me() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div className="px-6 pt-16 pb-8 h-full overflow-y-auto no-scrollbar">
      <div className="mb-12">
        <h1 className="text-sm font-medium tracking-widest text-muted uppercase mb-2">{t('me.title')}</h1>
        <div className="flex items-baseline space-x-3 mb-4">
           <span className="text-3xl font-light text-primary font-sans">Seen</span>
           {t('me.title_sub') && (
             <span className="text-xl font-light text-secondary font-serif">{t('me.title_sub')}</span>
           )}
        </div>
        <p className="text-sm text-secondary font-light">{t('me.subtitle')}</p>
      </div>

      <div className="space-y-6">
        <Section title={t('me.section_profile')}>
          <MenuItem 
            title={t('me.menu_profile')}
            subtitle={t('me.menu_profile_sub')}
            onClick={() => navigate('/me/profile')}
          />
        </Section>

        {/* About Me Section - New */}
        <Section title={t('me.section_questions')}>
          <MenuItem 
            title={t('me.menu_questions')}
            subtitle={t('me.menu_questions_sub')}
            onClick={() => navigate('/me/questions')}
          />
        </Section>

        <Section title={t('me.section_core')}>
          <MenuItem 
            title={t('me.menu_understanding')}
            subtitle={t('me.menu_understanding_sub')}
            onClick={() => navigate('/me/understanding')}
          />
          <MenuItem 
            title={t('me.menu_ai')}
            subtitle={t('me.menu_ai_sub')}
            onClick={() => navigate('/me/ai-response')}
          />
        </Section>

        <Section title={t('me.section_data')}>
          <MenuItem 
            title={t('me.menu_privacy')}
            subtitle={t('me.menu_privacy_sub')}
            onClick={() => navigate('/me/privacy')}
          />
          <MenuItem 
            title={t('me.menu_account')}
            subtitle={t('me.menu_account_sub')}
            onClick={() => navigate('/me/account')}
          />
        </Section>

        <div className="pt-8 text-center">
           <p className="mt-8 text-[10px] text-gray-300 uppercase tracking-widest">{t('me.version')}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">{title}</h3>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function MenuItem({ title, subtitle, onClick }: { title: string; subtitle: string; onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full flex items-center justify-between p-5 bg-white border border-gray-100 rounded-2xl hover:border-gray-300 transition-all duration-300 group shadow-sm"
    >
      <div className="text-left">
        <h4 className="text-base font-medium text-primary mb-1">{title}</h4>
        <p className="text-xs text-muted group-hover:text-secondary transition-colors">{subtitle}</p>
      </div>
      <ChevronRight size={18} className="text-gray-300 group-hover:text-primary transition-colors" />
    </button>
  );
}
