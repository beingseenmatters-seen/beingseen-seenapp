import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';

// Type definitions for the card data structure
type CardType = 'slider' | 'radio' | 'multiselect';

interface CardData {
  id: string;
  titleKey: string;
  type: CardType;
  optionsKey?: string; // Key prefix for options
  labelsKey?: string; // Key prefix for labels
  descKey: string;
}

const CARDS: CardData[] = [
  {
    id: 'value_orientation',
    titleKey: 'settings.understanding.cards.value_orientation.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.value_orientation.labels',
    descKey: 'settings.understanding.cards.value_orientation.desc'
  },
  {
    id: 'self_vs_relationship',
    titleKey: 'settings.understanding.cards.self_vs_relationship.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.self_vs_relationship.labels',
    descKey: 'settings.understanding.cards.self_vs_relationship.desc'
  },
  {
    id: 'conflict_handling',
    titleKey: 'settings.understanding.cards.conflict_handling.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.conflict_handling.labels',
    descKey: 'settings.understanding.cards.conflict_handling.desc'
  },
  {
    id: 'life_pace',
    titleKey: 'settings.understanding.cards.life_pace.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.life_pace.labels',
    descKey: 'settings.understanding.cards.life_pace.desc'
  },
  {
    id: 'connection_depth',
    titleKey: 'settings.understanding.cards.connection_depth.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.connection_depth.labels',
    descKey: 'settings.understanding.cards.connection_depth.desc'
  },
  {
    id: 'money_view',
    titleKey: 'settings.understanding.cards.money_view.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.money_view.labels',
    descKey: 'settings.understanding.cards.money_view.desc'
  },
  {
    id: 'risk_attitude',
    titleKey: 'settings.understanding.cards.risk_attitude.title',
    type: 'radio',
    optionsKey: 'settings.understanding.cards.risk_attitude.options',
    descKey: 'settings.understanding.cards.risk_attitude.desc'
  },
  {
    id: 'life_worth',
    titleKey: 'settings.understanding.cards.life_worth.title',
    type: 'multiselect',
    optionsKey: 'settings.understanding.cards.life_worth.options',
    descKey: 'settings.understanding.cards.life_worth.desc'
  },
  {
    id: 'expression_style',
    titleKey: 'settings.understanding.cards.expression_style.title',
    type: 'slider',
    labelsKey: 'settings.understanding.cards.expression_style.labels',
    descKey: 'settings.understanding.cards.expression_style.desc'
  },
  {
    id: 'connection_intent',
    titleKey: 'settings.understanding.cards.connection_intent.title',
    type: 'multiselect',
    optionsKey: 'settings.understanding.cards.connection_intent.options',
    descKey: 'settings.understanding.cards.connection_intent.desc'
  }
];

export default function Understanding() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { seenUser, updateProfile } = useAuth();
  
  // Load saved answers from Firestore
  const initialAnswers = useMemo(() => seenUser?.soulProfile?.understanding || {}, [seenUser]);
  
  const [answers, setAnswers] = useState<Record<string, any>>(initialAnswers);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialAnswers));
  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Track if there are unsaved changes
  const isDirty = useMemo(() => {
    return JSON.stringify(answers) !== savedSnapshot;
  }, [answers, savedSnapshot]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const handleSliderChange = (id: string, value: number) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const handleRadioChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const handleMultiSelectChange = (id: string, value: string) => {
    setAnswers(prev => {
      const current: string[] = prev[id] || [];
      if (current.includes(value)) {
        return { ...prev, [id]: current.filter(v => v !== value) };
      } else {
        return { ...prev, [id]: [...current, value] };
      }
    });
  };

  const handleSave = async () => {
    if (!isDirty) return;
    setIsSaving(true);
    
    try {
      await updateProfile({
        soulProfile: { understanding: answers }
      });
      
      setSavedSnapshot(JSON.stringify(answers));
      setToast(t('common.saved'));
      console.log('User profile saved:', { soulProfile: { understanding: answers } });
    } catch (error) {
      console.error('Failed to save understanding:', error);
      setToast('Error saving understanding');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    if (isDirty) {
      const ok = confirm(t('common.unsaved_confirm'));
      if (!ok) return;
    }
    navigate(-1);
  };

  // Helper to get array from translation
  const getArray = (key: string): string[] => {
    return t(key) as unknown as string[];
  };

  return (
    <div className="flex flex-col h-screen w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      {/* Mobile Container Simulator - same as AppLayout to ensure consistency */}
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button onClick={handleBack} className="p-2 -ml-2 text-secondary hover:text-primary transition-colors">
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">{t('settings.understanding.header')}</span>
          <div className="w-8" /> {/* Spacer */}
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="absolute top-16 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className="px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs shadow-lg">
              {toast}
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-12">
          <div className="pt-2 pb-6">
             <h1 className="text-2xl font-light text-primary mb-3">{t('settings.understanding.title')}</h1>
             <p className="text-secondary font-light text-sm leading-relaxed whitespace-pre-line">
               {t('settings.understanding.desc')}
             </p>
          </div>

          {CARDS.map((card, index) => {
            const options = card.optionsKey ? getArray(card.optionsKey) : [];
            const labels = card.labelsKey ? getArray(card.labelsKey) : [];
            const currentValue = answers[card.id];

            return (
              <motion.div 
                key={card.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="space-y-6 border-t border-dashed border-gray-200 pt-8 first:border-0 first:pt-0"
              >
                <div className="space-y-2">
                  <span className="text-[10px] text-muted tracking-widest uppercase">0{index + 1}</span>
                  <h3 className="text-lg font-medium text-primary leading-snug">{t(card.titleKey)}</h3>
                </div>

                {/* Input Area */}
                <div className="py-2">
                  {card.type === 'slider' && (
                    <div className="space-y-4">
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={currentValue ?? 50}
                        onChange={(e) => handleSliderChange(card.id, parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none touch-pan-x"
                        style={{ touchAction: 'pan-x' }}
                      />
                      <div className="flex justify-between text-xs text-secondary font-light">
                        <span>{labels[0]}</span>
                        <span>{labels[1]}</span>
                      </div>
                    </div>
                  )}

                  {card.type === 'radio' && (
                    <div className="space-y-3">
                      {options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => handleRadioChange(card.id, opt)}
                          className={clsx(
                            "w-full text-left p-4 rounded-xl border transition-all duration-200 text-sm font-light",
                            currentValue === opt 
                              ? "border-primary bg-primary text-white" 
                              : "border-gray-100 bg-white text-secondary hover:border-gray-300"
                          )}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {card.type === 'multiselect' && (
                    <div className="space-y-3">
                      {options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => handleMultiSelectChange(card.id, opt)}
                          className={clsx(
                            "w-full text-left p-4 rounded-xl border transition-all duration-200 text-sm font-light",
                            (currentValue || []).includes(opt)
                              ? "border-primary bg-primary text-white" 
                              : "border-gray-100 bg-white text-secondary hover:border-gray-300"
                          )}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50/50 rounded-lg p-3">
                  <p className="text-xs text-muted font-light leading-relaxed italic">
                     {t(card.descKey)}
                  </p>
                </div>
              </motion.div>
            );
          })}

          {/* Footer note - now part of scrollable content */}
          <div className="pb-24">
            <p className="text-[10px] text-center text-muted">
              {t('settings.understanding.footer')}
            </p>
          </div>
        </div>

        {/* Sticky Save Button at bottom - always visible */}
        <div className="shrink-0 sticky bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          <button 
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={clsx(
              "w-full py-4 rounded-2xl text-lg font-light transition-colors",
              isDirty && !isSaving
                ? "bg-primary text-white hover:bg-black" 
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            {isSaving ? '...' : t('settings.understanding.action_save')}
          </button>
        </div>
      </div>
    </div>
  );
}
