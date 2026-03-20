import { Outlet, NavLink } from 'react-router-dom';
import { MessageSquareText, Activity, Inbox, User } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../i18n';

export default function AppLayout() {
  const { t, effectiveLanguage } = useLanguage();
  const topBarHeight = 32;
  const bottomBarHeight = 28;
  const navHeight = 52;

  return (
    <div className="fixed inset-0 w-full bg-surface overflow-hidden text-primary font-sans selection:bg-gray-200">
      {/* Mobile Container — Stack root */}
      <div className="relative h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl overflow-hidden">
        
        {/* ===== TOP BRANDING BAR — absolute, anchored to top edge ===== */}
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
              {effectiveLanguage === 'zh' ? '你，值得被看见' : 'Being Seen Matters'}
            </span>
          </div>
        </div>

        {/* ===== FIXED BOTTOM SHELL — truly anchored to the bottom edge ===== */}
        <div className="absolute inset-x-0 bottom-0 z-50">
          <nav
            className="flex justify-around items-center border-t border-gray-100 bg-white"
            style={{ height: `${navHeight}px` }}
          >
            <NavItem to="/" icon={<MessageSquareText size={22} strokeWidth={1.5} />} label={t('nav.reflect')} />
            <NavItem to="/resonate" icon={<Activity size={22} strokeWidth={1.5} />} label={t('nav.resonate')} />
            <NavItem to="/inbox" icon={<Inbox size={22} strokeWidth={1.5} />} label={t('nav.inbox')} />
            <NavItem to="/me" icon={<User size={22} strokeWidth={1.5} />} label={t('nav.me')} />
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
              {effectiveLanguage === 'zh' ? '相信真诚的力量' : 'Believe in sincerity'}
            </span>
          </div>
        </div>

        {/* ===== MAIN CONTENT LAYER — isolated between fixed bars ===== */}
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

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => clsx(
        "flex flex-col items-center justify-center space-y-0.5 w-16 transition-colors duration-300",
        isActive 
          ? "text-green-600" 
          : "text-gray-800 hover:text-gray-600"
      )}
    >
      {icon}
      <span className="text-[10px] tracking-wider font-medium">{label}</span>
    </NavLink>
  );
}
