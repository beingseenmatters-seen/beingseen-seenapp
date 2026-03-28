import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { usePlatform } from '../hooks/usePlatform';

export default function Me() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();
  const { seenUser, signOut } = useAuth();
  const { isDesktop } = usePlatform();

  const understandingProgress = seenUser?.understandingProgress ?? 0;
  const totalQuestions = 6;
  const isComplete = understandingProgress >= totalQuestions;
  const lang = effectiveLanguage === 'zh' ? 'zh' : 'en';

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('nav.me')}
        </span>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto no-scrollbar ${isDesktop ? 'max-w-3xl mx-auto w-full px-8 pb-12' : 'px-6 pb-8'}`}>
      {/* Page header */}
      <div className="mb-10 pt-4">
        <div className="flex items-baseline space-x-3 mb-4">
          <span className="text-3xl font-light text-primary font-sans">Seen</span>
          {t('me.title_sub') && (
            <span className="text-xl font-light text-secondary font-serif">{t('me.title_sub')}</span>
          )}
        </div>
        <p className="text-sm text-secondary font-light">{t('me.subtitle')}</p>
      </div>

      <div className="space-y-8">
        {/* ==================== 1. My Understanding ==================== */}
        {/*
          TODO (Spec §十): This section should display layered insights:
          - Stable traits (high confidence, multi-session verified)
          - Current dynamic state (mood, energy — transient)
          - Candidate insights (single-session, awaiting verification)
          - Multi-session summary (aggregated self-understanding)
        */}
        <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {lang === 'zh' ? '我的理解' : 'My Understanding'}
          </h3>
          <p className="text-sm text-secondary font-light leading-relaxed">
            {lang === 'zh'
              ? '基于你的对话逐步构建的抽象理解。原始对话会自动过期，但理解会留下。'
              : 'An abstract understanding built progressively from your conversations. Raw chats expire, but understanding remains.'}
          </p>
          <button
            onClick={() => navigate('/me/understanding')}
            className="text-xs text-primary font-medium inline-flex items-center gap-1 hover:gap-2 transition-all"
          >
            {lang === 'zh' ? '查看详情 →' : 'View details →'}
          </button>
        </div>

        {/* ==================== 2. Inner Structure ==================== */}
        <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {lang === 'zh' ? '内在结构' : 'Inner Structure'}
          </h3>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {lang === 'zh' ? '理解进度' : 'Understanding Progress'}
              </span>
              <span className="text-xs font-medium text-primary">
                {understandingProgress} / {totalQuestions}
              </span>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: totalQuestions }).map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    idx < understandingProgress ? 'bg-primary' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ==================== 3. Continue Understanding CTA ==================== */}
        {!isComplete && (
          <div className="p-5 bg-white rounded-2xl border border-gray-100 space-y-4">
            <p className="text-sm text-secondary font-light leading-relaxed whitespace-pre-line">
              {lang === 'zh'
                ? '这些洞察帮助塑造你被理解的方式——\n以及你与他人连接的方式。\n\n你的资料越完整，\n你的体验就越有意义。'
                : 'These insights help shape how you are understood —\nand how you connect with others.\n\nThe more complete your profile is,\nthe more meaningful your experience will be.'}
            </p>
            <button
              onClick={() => navigate('/me/questions')}
              className="w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors flex items-center justify-center gap-1"
            >
              {lang === 'zh' ? '继续 →' : 'Continue →'}
            </button>
          </div>
        )}

        {/* ==================== Settings Sections ==================== */}
        <Section title={t('me.section_profile')}>
          <MenuItem
            title={t('me.menu_profile')}
            subtitle={t('me.menu_profile_sub')}
            onClick={() => navigate('/me/profile')}
          />
        </Section>

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

        {/* Logout — only show in mobile (web has it in sidebar) */}
        {!isDesktop && (
          <div className="pt-4">
            <button
              onClick={handleLogout}
              className="w-full py-3 rounded-xl border border-gray-200 text-secondary text-sm hover:bg-gray-50 transition-colors"
            >
              {t('me.logout')}
            </button>
          </div>
        )}

        <div className="pt-4 text-center">
          <p className="mt-4 text-[10px] text-gray-400 uppercase tracking-widest">{t('me.version')}</p>
        </div>
      </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider pl-1">{title}</h3>
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
      <ChevronRight size={18} className="text-gray-400 group-hover:text-primary transition-colors" />
    </button>
  );
}
