import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { MessageSquareText, SquarePen, X } from 'lucide-react';
import clsx from 'clsx';
import type { RetainedConversation } from '../services/recentConversations';
import { formatRelativeTime } from '../services/recentConversations';

interface ReflectHistoryDrawerProps {
  open: boolean;
  conversations: RetainedConversation[];
  activeConversationId?: string;
  effectiveLanguage: string;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

export default function ReflectHistoryDrawer({
  open,
  conversations,
  activeConversationId,
  effectiveLanguage,
  onClose,
  onSelectConversation,
  onNewConversation,
}: ReflectHistoryDrawerProps) {
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -80 || info.velocity.x < -500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={onClose}
            aria-label={effectiveLanguage === 'zh' ? '关闭侧边栏' : 'Close sidebar'}
          />

          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            drag="x"
            dragDirectionLock
            dragElastic={0.08}
            onDragEnd={handleDragEnd}
            className="absolute inset-y-0 left-0 z-50 w-[82%] max-w-[320px] border-r border-gray-100 bg-white shadow-2xl"
            style={{
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-gray-100 px-4 pb-3 pt-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Seen
                    </p>
                    <h2 className="mt-1 text-sm font-medium text-primary">
                      {effectiveLanguage === 'zh' ? '短期对话' : 'Recent Conversations'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                    aria-label={effectiveLanguage === 'zh' ? '关闭' : 'Close'}
                  >
                    <X size={18} strokeWidth={1.75} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNewConversation();
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-white transition-colors hover:bg-black"
                >
                  <SquarePen size={16} strokeWidth={1.75} />
                  <span>{effectiveLanguage === 'zh' ? '开启新对话' : 'New conversation'}</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3">
                {conversations.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-5 text-center">
                    <MessageSquareText size={18} strokeWidth={1.6} className="text-gray-300" />
                    <p className="mt-3 text-sm font-medium text-gray-600">
                      {effectiveLanguage === 'zh' ? '还没有短期保存的对话' : 'No short-term conversations yet'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400">
                      {effectiveLanguage === 'zh'
                        ? '开始一段新的表达后，短期保存的对话会出现在这里。'
                        : 'Saved short-term conversations will appear here after you start reflecting.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {conversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;

                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectConversation(conversation.id);
                          }}
                          className={clsx(
                            'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
                            isActive
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-transparent bg-gray-50 text-gray-700 hover:border-gray-200 hover:bg-white',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={clsx(
                                'truncate text-sm font-medium',
                                isActive ? 'text-white' : 'text-primary',
                              )}>
                                {conversation.title || (effectiveLanguage === 'zh' ? '对话' : 'Conversation')}
                              </p>
                              <p className={clsx(
                                'mt-1 text-[11px]',
                                isActive ? 'text-white/70' : 'text-gray-400',
                              )}>
                                {formatRelativeTime(conversation.createdAt, effectiveLanguage === 'zh' ? 'zh' : 'en')}
                              </p>
                            </div>
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-white/12 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/80">
                                {effectiveLanguage === 'zh' ? '当前' : 'Active'}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
