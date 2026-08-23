import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, MoreHorizontal, Send, Check, X, Loader2, Heart, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { 
  getInboxRequests, 
  getUserConnections, 
  acceptConnectionRequest, 
  declineConnectionRequest,
  sendMessage,
  subscribeToMessages
} from '../services/connections';
import type { ConnectionRequest, Connection, ChatMessage } from '../services/connections';
import { asConnectionOrigin, devPreviewOrigin } from '../services/connectionOrigin';

export default function Inbox() {
  const { t, effectiveLanguage } = useLanguage();
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  const selectedConnection = connections.find(c => c.id === selectedId);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    
    if (selectedId) {
      unsubscribe = subscribeToMessages(selectedId, (newMessages) => {
        setMessages(newMessages);
      });
    } else {
      setMessages([]);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [selectedId]);

  useEffect(() => {
    async function loadData() {
      if (!firebaseUser?.uid) return;
      setIsLoading(true);
      const [reqs, conns] = await Promise.all([
        getInboxRequests(firebaseUser.uid),
        getUserConnections(firebaseUser.uid)
      ]);
      setRequests(reqs);
      setConnections(conns);
      setIsLoading(false);
    }
    loadData();
  }, [firebaseUser?.uid]);

  const handleAccept = async (req: ConnectionRequest) => {
    if (!req.id) return;
    setActionLoadingId(req.id);
    const success = await acceptConnectionRequest(req.id);
    if (success) {
      setRequests(prev => prev.filter(r => r.id !== req.id));
      // Refresh connections
      if (firebaseUser?.uid) {
        const conns = await getUserConnections(firebaseUser.uid);
        setConnections(conns);
      }
    }
    setActionLoadingId(null);
  };

  const handleDecline = async (req: ConnectionRequest) => {
    if (!req.id) return;
    setActionLoadingId(req.id);
    const success = await declineConnectionRequest(req.id);
    if (success) {
      setRequests(prev => prev.filter(r => r.id !== req.id));
    }
    setActionLoadingId(null);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedId || !firebaseUser?.uid || isSending) return;
    setIsSending(true);
    const text = inputValue;
    setInputValue(""); // Optimistic clear
    
    const success = await sendMessage(selectedId, firebaseUser.uid, text);
    if (!success) {
      // Revert if failed
      setInputValue(text);
    }
    setIsSending(false);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('nav.inbox')}
        </span>
      </div>
      <div className="flex-1 min-h-0 relative">
      <AnimatePresence initial={false} mode="wait">
        
        {/* List View */}
        {!selectedId && (
          <motion.div 
            key="list" 
            initial={{ opacity: 0, x: -20 }} 
            animate={{ opacity: 1, x: 0 }} 
            exit={{ opacity: 0, x: -20 }} 
            className="px-6 pt-4 h-full flex flex-col overflow-y-auto no-scrollbar pb-8"
          >
            <div className="space-y-1 mb-6">
              <p className="text-secondary font-light text-sm">{t('inbox.subtitle')}</p>
            </div>

            {/* 有句话，想送给 TA — the bridge into Gift.Seen. Carries Gift.Seen's
                established theme (coral #EC6A6E / rose #E0536E, heart gradient
                #F5836F→#EE5D79 from the Gift.Seen tokens) in a restrained way:
                tinted card + gradient heart + rose accents. Wording unchanged. */}
            <button
              onClick={() => navigate('/connect/express')}
              className="w-full flex items-center justify-between p-5 mb-6 rounded-2xl bg-[#FDF3F4] border border-[#F6DCE0] hover:border-[#EC6A6E]/60 transition-colors text-left group"
              data-testid="giftseen-entry"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm"
                  style={{ background: 'linear-gradient(180deg, #F5836F 0%, #EE5D79 100%)' }}
                >
                  <Heart size={18} strokeWidth={1.8} fill="currentColor" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-medium text-primary truncate">{t('express.title')}</p>
                  <p className="text-xs font-light truncate text-[#C7455F]">{t('express.entry_sub')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 ml-3 text-[#E0536E]/70 group-hover:text-[#E0536E] transition-colors" />
            </button>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-gray-300" size={24} />
              </div>
            ) : (
              <div className="flex-1 space-y-8">
                
                {/* Pending Requests */}
                {requests.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-medium text-muted uppercase tracking-wider">
                      {effectiveLanguage === 'zh' ? '新的连接请求' : 'New Requests'}
                    </h4>
                    {requests.map(req => (
                      <div key={req.id} className="p-5 rounded-2xl bg-gray-50 border border-gray-100">
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="text-base font-medium text-primary">
                            {req.senderProfile?.nickname || 'Someone'}
                          </h3>
                          <span className="text-xs text-muted">
                            {new Date(req.createdAt?.toMillis?.() || Date.now()).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-secondary font-light mb-4">
                          {req.reason}
                        </p>
                        <div className="flex space-x-3">
                          <button 
                            onClick={() => handleAccept(req)}
                            disabled={actionLoadingId === req.id}
                            className="flex-1 py-2.5 bg-primary text-white text-sm rounded-xl hover:bg-black transition-colors flex items-center justify-center"
                          >
                            {actionLoadingId === req.id ? <Loader2 className="animate-spin" size={16} /> : <><Check size={16} className="mr-1.5" /> {effectiveLanguage === 'zh' ? '接受' : 'Accept'}</>}
                          </button>
                          <button 
                            onClick={() => handleDecline(req)}
                            disabled={actionLoadingId === req.id}
                            className="flex-1 py-2.5 border border-gray-200 text-secondary text-sm rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center"
                          >
                            {actionLoadingId === req.id ? <Loader2 className="animate-spin" size={16} /> : <><X size={16} className="mr-1.5" /> {effectiveLanguage === 'zh' ? '忽略' : 'Decline'}</>}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Connections */}
                <div className="space-y-4">
                  <h4 className="text-xs font-medium text-muted uppercase tracking-wider">
                    {effectiveLanguage === 'zh' ? '已连接' : 'Connections'}
                  </h4>
                  {connections.length === 0 && requests.length === 0 && (
                    <p className="text-sm text-muted font-light">
                      {effectiveLanguage === 'zh' ? '暂无消息' : 'No messages yet'}
                    </p>
                  )}
                  {connections.map(conn => (
                    <button 
                      key={conn.id}
                      onClick={() => setSelectedId(conn.id || "1")}
                      className="w-full text-left p-5 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-base font-medium text-primary">
                          {conn.otherUserProfile?.nickname || 'Someone'}
                        </h3>
                        <span className="text-xs text-muted">
                          {new Date(conn.lastMessageAt?.toMillis?.() || conn.createdAt?.toMillis?.() || Date.now()).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-secondary font-light line-clamp-1">
                        {conn.lastMessage || (effectiveLanguage === 'zh' ? '点击开始对话...' : 'Tap to start conversation...')}
                      </p>
                    </button>
                  ))}
                </div>

              </div>
            )}
          </motion.div>
        )}

        {/* Conversation View */}
        {selectedId && (
          <motion.div 
             key="conversation"
             initial={{ opacity: 0, x: 20 }} 
             animate={{ opacity: 1, x: 0 }} 
             exit={{ opacity: 0, x: 20 }} 
             className="h-full flex flex-col"
          >
            {/* Header */}
            <div className="px-6 pt-12 pb-4 border-b border-gray-50 flex justify-between items-center bg-white z-10">
              <button onClick={() => setSelectedId(null)} className="p-2 -ml-2 text-secondary hover:text-primary">
                <ChevronLeft size={24} strokeWidth={1.5} />
              </button>
              <div className="text-center">
                <span className="text-xs text-muted uppercase tracking-widest">{t('inbox.header_tag')}</span>
              </div>
              <button className="p-2 -mr-2 text-secondary hover:text-primary">
                <MoreHorizontal size={24} strokeWidth={1.5} />
              </button>
            </div>

            {/* Connection Origin (同频遇见): branded title + emotional explanation
                (primary) + category tag (secondary). */}
            <div className="px-6 py-4 bg-gray-50/50">
              <p className="text-xs text-muted mb-1 tracking-wide">{t('connection_origin.title')}</p>
              {(() => {
                const origin = devPreviewOrigin() ?? asConnectionOrigin(selectedConnection?.origin);
                if (!origin) return null;
                return (
                  <>
                    <p className="text-sm text-primary font-light leading-relaxed whitespace-pre-line mb-2">
                      {t(`connection_origin.${origin}.explanation`)}
                    </p>
                    <span className="inline-block px-2 py-1 bg-white border border-gray-100 rounded-full text-xs text-secondary">
                      {t(`connection_origin.${origin}.tag`)}
                    </span>
                  </>
                );
              })()}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.length === 0 && (
                <div className="flex justify-center">
                  <p className="text-xs text-muted text-center max-w-[80%] whitespace-pre-wrap leading-relaxed">
                    {t('inbox.system_msg')}
                  </p>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.senderUid === firebaseUser?.uid;
                return (
                  <div key={msg.id} className={clsx("flex", isMe ? "justify-end" : "justify-start")}>
                    <div className={clsx(
                      "px-5 py-3 rounded-2xl max-w-[85%]",
                      isMe 
                        ? "bg-primary text-white rounded-tr-none" 
                        : "bg-gray-100 text-primary rounded-tl-none"
                    )}>
                       <p className="text-base font-light leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-gray-50 pb-8 bg-white">
              <div className="relative flex items-end">
                <textarea 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t('inbox.placeholder')}
                  className="w-full bg-gray-50 rounded-2xl py-4 pl-4 pr-12 text-base text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gray-200 resize-none min-h-[60px] max-h-32"
                  rows={1}
                />
                <button 
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="absolute right-2 bottom-2 p-2 text-primary disabled:text-gray-300 transition-colors"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>

          </motion.div>
        )}

      </AnimatePresence>
      </div>
    </div>
  );
}