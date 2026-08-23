import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { usePlatform } from '../hooks/usePlatform';
import { useKeptReflections } from '../hooks/useKeptReflections';
import {
  momentsClient,
  refreshMomentLibraryFromRemote,
} from '../services/moments/momentsClient';
import { MOMENT_APP_URL } from '../config/ecosystem';
import type { MomentsOverview } from '../services/moments/momentsService';

export default function Me() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const { isDesktop } = usePlatform();
  const { reflections } = useKeptReflections();

  const [moments, setMoments] = useState<MomentsOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshMomentLibraryFromRemote({ force: true });
      if (cancelled) return;
      try {
        setMoments(await momentsClient.getOverview());
      } catch {
        setMoments(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const keptCount = reflections.length;

  const handleLogout = async () => {
    await signOut();
  };

  const handleStartMoments = async () => {
    await refreshMomentLibraryFromRemote({ force: true });
    const session = await momentsClient.createSession();
    navigate(`/moments/session/${session.id}`);
  };

  const hasActive = !!moments?.activeSession;
  const hasHistory = (moments?.completedCount ?? 0) > 0;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('nav.me')}
        </span>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto no-scrollbar ${isDesktop ? 'max-w-3xl mx-auto w-full px-8 pb-12' : 'px-6 pb-8'}`}>
      {/* Page header — Me on the left, the Moment.Seen ecosystem entry on the
          right (an ecosystem shortcut, deliberately NOT a profile card below).
          On narrow layouts the entry stacks naturally beneath the header. */}
      <div className="mb-10 pt-4 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-baseline space-x-3 mb-4">
            <span className="text-3xl font-light text-primary font-sans">Seen</span>
            {t('me.title_sub') && (
              <span className="text-xl font-light text-secondary font-serif">{t('me.title_sub')}</span>
            )}
          </div>
          <p className="text-sm text-secondary font-light">{t('me.subtitle')}</p>
        </div>

        {/* Moment.Seen — sibling product. Founder decision: the LOGO ITSELF is
            the link (no CTA button; the brand color lives in the icon). Plain
            cross-origin link (no token handoff), URL via config/env. */}
        <a
          href={MOMENT_APP_URL}
          aria-label={`${t('me.momentseen_name')} — ${t('me.momentseen_sub')}`}
          title={`${t('me.momentseen_name')} — ${t('me.momentseen_sub')}`}
          className="shrink-0 self-start rounded-2xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C64573]/50"
          data-testid="momentseen-entry"
        >
          <img
            src="/moment-seen-icon.png"
            alt={t('me.momentseen_name')}
            width={52}
            height={52}
            className="rounded-2xl shadow-sm ring-1 ring-stone-200/60"
            draggable={false}
          />
        </a>
      </div>

      <div className="space-y-8">
        {/* ==================== A. 基础资料 ==================== */}
        <Section title={t('me.section_profile')}>
          <MenuItem
            title={t('me.menu_profile')}
            subtitle={t('me.menu_profile_sub')}
            onClick={() => navigate('/me/profile')}
          />
        </Section>

        {/* ==================== B. Seen 眼中的你 ==================== */}
        <Section title={t('me.section_seen')}>
          {/*
            Permanent home for Current Understanding (architecture frozen).
            Placeholder only — do NOT implement Current Understanding here.
            When CU ships, replace this card in place; no layout change required.
          */}
          <div
            className="p-5 bg-white rounded-2xl border border-stone-200/90 shadow-sm space-y-4"
            data-testid="current-understanding-placeholder"
          >
            <div className="space-y-1.5">
              <h3 className="text-base font-light text-primary leading-snug">
                {t('me.current_understanding_title')}
              </h3>
              <p className="text-xs text-muted font-light leading-relaxed whitespace-pre-line">
                {t('me.current_understanding_body')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/me/current-understanding')}
              className="w-full py-3 rounded-xl border border-stone-200 text-primary text-sm font-medium hover:bg-stone-50 transition-colors"
            >
              {t('me.current_understanding_cta')}
            </button>
          </div>

          {/* Dynamic primary card: start a set, or continue the unfinished one */}
          <div className="p-5 bg-white rounded-2xl border border-stone-200/90 shadow-sm space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-light text-primary leading-snug">
                {hasActive ? t('me.moments_progress_title') : t('me.moments_empty_title')}
              </h3>
              <p className="text-xs text-muted font-light leading-relaxed tabular-nums">
                {hasActive
                  ? t('me.moments_progress_line')
                      .replace('{{n}}', String(moments?.answeredCount ?? 0))
                      .replace('{{total}}', String(moments?.sessionSize ?? 10))
                  : t('me.moments_empty_sub')}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                hasActive
                  ? navigate(`/moments/session/${moments!.activeSession!.id}`)
                  : handleStartMoments()
              }
              className="w-full py-3 rounded-xl text-white text-sm font-medium bg-gradient-to-r from-[#C64573] to-[#6B4FD8] hover:from-[#B93E68] hover:to-[#5F45C4] transition-colors"
            >
              {hasActive ? t('me.moments_progress_cta') : t('me.moments_empty_cta')}
            </button>
          </div>

          {hasHistory && (
            <>
              {moments?.latestCompletedSessionId && (
                <MenuItem
                  title={t('me.menu_latest_sketch')}
                  subtitle={t('me.menu_latest_sketch_sub')}
                  onClick={() => navigate(`/me/sketches/${moments.latestCompletedSessionId}`)}
                />
              )}
              <MenuItem
                title={t('me.menu_all_sketches')}
                subtitle={t('me.menu_all_sketches_sub').replace(
                  '{{n}}',
                  String(moments?.completedCount ?? 0),
                )}
                onClick={() => navigate('/me/sketches')}
              />
            </>
          )}

          {/*
            Reflect long-term surface only: approved Understanding Updates.
            Founder Architecture Decision — FROZEN (2026-08-06): not chat history;
            not Current Understanding; Moments Sketches stay separate.
          */}
          <MenuItem
            title={t('me.kept_understandings_title')}
            subtitle={
              keptCount === 0
                ? t('me.kept_understandings_empty')
                : t('me.kept_understandings_count').replace('{{count}}', String(keptCount))
            }
            description={t('me.kept_understandings_sub')}
            onClick={() => navigate('/me/reflect-understandings')}
          />
        </Section>

        {/* ==================== C. 数据与隐私 ==================== */}
        <Section title={t('me.section_data')}>
          <MenuItem
            title={t('me.menu_privacy')}
            subtitle={t('me.menu_privacy_sub')}
            onClick={() => navigate('/me/privacy')}
          />
        </Section>

        {/* ==================== D. 账户 ==================== */}
        <Section title={t('me.section_account')}>
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

function MenuItem({
  title,
  subtitle,
  description,
  onClick,
}: {
  title: string;
  subtitle: string;
  description?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-5 bg-white border border-gray-100 rounded-2xl hover:border-gray-300 transition-all duration-300 group shadow-sm"
    >
      <div className="text-left space-y-1">
        <h4 className="text-base font-medium text-primary">{title}</h4>
        {description && (
          <p className="text-xs text-secondary font-light leading-relaxed">{description}</p>
        )}
        <p className="text-xs text-muted group-hover:text-secondary transition-colors">{subtitle}</p>
      </div>
      <ChevronRight size={18} className="text-gray-400 group-hover:text-primary transition-colors shrink-0 ml-3" />
    </button>
  );
}
