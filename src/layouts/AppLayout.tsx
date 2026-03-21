import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { MessageSquareText, Activity, Inbox, User } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { usePlatform } from '../hooks/usePlatform';
import Sidebar from '../components/Sidebar';

export default function AppLayout() {
  const { isDesktop } = usePlatform();

  return isDesktop ? <WebLayout /> : <MobileLayout />;
}

// =============================================================================
// Web Layout — ChatGPT-style: left sidebar + central workspace
// =============================================================================

function WebLayout() {
  const { effectiveLanguage } = useLanguage();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="fixed inset-0 flex bg-white text-gray-800 font-sans selection:bg-gray-200">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-center h-8 border-b border-gray-50">
          <span className="text-[10px] font-semibold tracking-[0.25em] text-gray-500 uppercase leading-none">
            {effectiveLanguage === 'zh' ? '你，值得被看见' : 'BEING SEEN MATTERS'}
          </span>
        </div>
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
        <div className="shrink-0 flex items-center justify-center h-7 border-t border-gray-50">
          <span className="text-[10px] font-semibold tracking-[0.2em] text-gray-500 uppercase leading-none">
            {effectiveLanguage === 'zh' ? '相信真诚的力量' : 'BELIEVE IN SINCERITY.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Mobile Layout — preserved bottom tab bar (existing behavior)
// =============================================================================

function MobileLayout() {
  const { t, effectiveLanguage } = useLanguage();
  const topBarHeight = 32;
  const bottomBarHeight = 28;
  const navHeight = 52;

  return (
    <div className="fixed inset-0 w-full bg-surface overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="relative h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl overflow-hidden">

        {/* Top branding bar */}
        <div
          className="absolute inset-x-0 top-0 z-50 bg-gray-100"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div
            className="flex items-center justify-center"
            style={{ height: `${topBarHeight}px` }}
          >
            <span
              className="font-semibold tracking-[0.25em] text-gray-500 uppercase leading-none"
              style={{ fontSize: '15px' }}
            >
              {effectiveLanguage === 'zh' ? '你，值得被看见' : 'BEING SEEN MATTERS'}
            </span>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="absolute inset-x-0 bottom-0 z-50">
          <nav
            className="flex justify-around items-center border-t border-gray-100 bg-white"
            style={{ height: `${navHeight}px` }}
          >
            <MobileNavItem to="/" icon={<MessageSquareText size={22} strokeWidth={1.5} />} label={t('nav.reflect')} />
            <MobileNavItem to="/resonate" icon={<Activity size={22} strokeWidth={1.5} />} label={t('nav.resonate')} />
            <MobileNavItem to="/inbox" icon={<Inbox size={22} strokeWidth={1.5} />} label={t('nav.inbox')} />
            <MobileNavItem to="/me" icon={<User size={22} strokeWidth={1.5} />} label={t('nav.me')} />
          </nav>

          <div
            className="bg-gray-100 flex items-end justify-center"
            style={{
              height: `calc(${bottomBarHeight}px + env(safe-area-inset-bottom))`,
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <span
              className="font-semibold tracking-[0.2em] text-gray-500 uppercase leading-none"
              style={{ fontSize: '13px' }}
            >
              {effectiveLanguage === 'zh' ? '相信真诚的力量' : 'BELIEVE IN SINCERITY.'}
            </span>
          </div>
        </div>

        {/* Main content */}
        <div
          className="absolute inset-x-0"
          style={{
            top: `calc(env(safe-area-inset-top) + ${topBarHeight}px)`,
            bottom: `calc(env(safe-area-inset-bottom) + ${bottomBarHeight + navHeight}px)`,
          }}
        >
          <main className="h-full overflow-y-auto no-scrollbar">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function MobileNavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => clsx(
        'flex flex-col items-center justify-center space-y-0.5 w-16 transition-colors duration-300',
        isActive
          ? 'text-green-600'
          : 'text-gray-800 hover:text-gray-600'
      )}
    >
      {icon}
      <span className="text-[10px] tracking-wider font-medium">{label}</span>
    </NavLink>
  );
}
