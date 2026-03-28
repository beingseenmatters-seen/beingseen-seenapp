import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MessageSquareText, Activity, Inbox, User, PanelLeftClose, PanelLeft, LogOut, Sparkles, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { useRecentConversations } from '../hooks/useRecentConversations';
import { formatRelativeTime } from '../services/recentConversations';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t, effectiveLanguage } = useLanguage();
  const { seenUser, signOut } = useAuth();
  const { conversations, remove } = useRecentConversations();
  const [hovered, setHovered] = useState<string | null>(null);
  const navigate = useNavigate();

  const navItems = [
    { to: '/', icon: MessageSquareText, label: t('nav.reflect') },
    { to: '/resonate', icon: Activity, label: t('nav.resonate') },
    { to: '/inbox', icon: Inbox, label: t('nav.inbox') },
    { to: '/me', icon: User, label: t('nav.me') },
  ];

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <aside
      className={clsx(
        'h-full flex flex-col bg-gray-50 border-r border-gray-100 transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo + Toggle */}
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        {!collapsed && (
          <span className="text-lg font-light tracking-widest text-gray-800 uppercase select-none">
            Seen
          </span>
        )}
        <button
          onClick={onToggle}
          className={clsx(
            'p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors',
            collapsed && 'mx-auto'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="shrink-0 flex flex-col gap-0.5 px-2 pt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg transition-colors duration-150',
                collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
                isActive
                  ? 'bg-white text-green-600 shadow-sm'
                  : 'text-gray-600 hover:bg-white/60 hover:text-gray-800'
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={20} strokeWidth={1.6} className="shrink-0" />
            {!collapsed && (
              <span className="text-sm font-medium truncate">{item.label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Recent Conversations — independent section */}
      {!collapsed && (
        <div className="flex-1 min-h-0 flex flex-col px-2 pt-3">
          <div className="mx-1 mb-2 border-t border-gray-200/60" />
          <div className="px-2 mb-1.5">
            <h3 className="text-[9px] font-semibold tracking-[0.15em] text-gray-500 uppercase">
              {t('nav.recent_title')}
            </h3>
            <p className="text-[9px] text-gray-400 mt-0.5 leading-snug">
              {t('nav.recent_hint')}
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-px">
            {conversations.length === 0 ? (
              <p className="px-2 text-[10px] text-gray-400 italic">
                {t('nav.recent_empty')}
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className="group relative flex items-center rounded-md hover:bg-white/60 transition-colors cursor-pointer"
                  onMouseEnter={() => setHovered(c.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    navigate(`/?conversation=${c.id}`);
                  }}
                >
                  <div className="flex-1 min-w-0 px-2.5 py-2">
                    <p className="text-xs text-gray-600 truncate leading-snug">
                      {c.title || (effectiveLanguage === 'zh' ? '对话' : 'Conversation')}
                    </p>
                    <p className="text-[9px] text-gray-400 mt-0.5">
                      {formatRelativeTime(c.createdAt, effectiveLanguage === 'zh' ? 'zh' : 'en')}
                    </p>
                  </div>
                  {hovered === c.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t('nav.recent_delete_confirm'))) {
                          remove(c.id);
                        }
                      }}
                      className="shrink-0 p-1 mr-1 rounded text-gray-400 hover:text-red-400 transition-colors"
                      title={t('nav.recent_delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {/* Bottom section — AI role + user + logout */}
      <div className="shrink-0 px-2 pb-3 space-y-1">
        {/* AI style subtle note — bound to saved aiPreference.role */}
        {!collapsed && (() => {
          const savedRole = seenUser?.soulProfile?.aiPreference?.role || 'mirror';
          const roleKey = ['mirror', 'organizer', 'helper', 'guide'].includes(savedRole) ? savedRole : 'mirror';
          return (
            <div className="px-3 py-2 text-[10px] text-gray-500 leading-relaxed">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Sparkles size={11} className="text-gray-400" />
                <span className="uppercase tracking-wider font-medium text-gray-400">
                  {effectiveLanguage === 'zh' ? '默认角色' : 'Default Role'}
                </span>
              </div>
              <div className="font-medium text-gray-600 mb-0.5">
                {t(`settings.ai_response.roles.${roleKey}.title`)}
              </div>
              <div className="text-gray-400">
                {t(`settings.ai_response.roles.${roleKey}.desc`)}
              </div>
            </div>
          );
        })()}

        {/* User area */}
        <div
          className={clsx(
            'flex items-center rounded-lg px-3 py-2',
            collapsed ? 'justify-center' : 'gap-3'
          )}
        >
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-medium shrink-0">
            {(seenUser?.nickname || seenUser?.email || '?').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">
                {seenUser?.nickname || (effectiveLanguage === 'zh' ? '用户' : 'User')}
              </p>
              <p className="text-[10px] text-gray-400 truncate">{seenUser?.email || ''}</p>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className={clsx(
            'flex items-center gap-3 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors w-full',
            collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'
          )}
          title={collapsed ? t('me.logout') : undefined}
        >
          <LogOut size={18} strokeWidth={1.6} className="shrink-0" />
          {!collapsed && (
            <span className="text-xs font-medium">{t('me.logout')}</span>
          )}
        </button>
      </div>
    </aside>
  );
}
