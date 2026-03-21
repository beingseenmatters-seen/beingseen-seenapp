import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, MoreHorizontal, Send } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../i18n';

export default function Inbox() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const { t } = useLanguage();
  
  const [messages, setMessages] = useState([
     { id: 1, text: t('inbox.system_msg'), system: true }
  ]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    setMessages([...messages, { id: Date.now(), text: inputValue, system: false }]);
    setInputValue("");
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
            className="px-6 pt-4 h-full flex flex-col"
          >
            <div className="space-y-1 mb-6">
              <p className="text-secondary font-light text-sm">{t('inbox.subtitle')}</p>
            </div>

            <div className="flex-1 space-y-4">
              {/* Conversation Item */}
              <button 
                onClick={() => setSelectedId("1")}
                className="w-full text-left p-6 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors group"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-medium text-primary">{t('inbox.item_title')}</h3>
                  <span className="text-xs text-muted">{t('inbox.time_ago')}</span>
                </div>
                <p className="text-sm text-secondary font-light line-clamp-2">
                  {t('inbox.item_desc')}
                </p>
              </button>
            </div>
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

            {/* Connection Reason Banner */}
            <div className="px-6 py-4 bg-gray-50/50">
               <p className="text-xs text-muted mb-2">{t('inbox.connection_reason')}</p>
               <div className="flex flex-wrap gap-2">
                 <span className="px-2 py-1 bg-white border border-gray-100 rounded text-xs text-secondary">{t('resonate.dim_conflict')}</span>
                 <span className="px-2 py-1 bg-white border border-gray-100 rounded text-xs text-secondary">{t('resonate.dim_pace')}</span>
               </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={clsx("flex", msg.system ? "justify-center" : "justify-end")}>
                  {msg.system ? (
                     <p className="text-xs text-muted text-center max-w-[80%] whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  ) : (
                    <div className="bg-primary text-white px-5 py-3 rounded-2xl rounded-tr-none max-w-[85%]">
                       <p className="text-base font-light leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  )}
                </div>
              ))}
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