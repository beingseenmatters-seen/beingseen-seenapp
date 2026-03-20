import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '../i18n';

type CardType = 'hobby' | 'self_desc' | 'zodiac' | null;

interface OptionalCardsProps {
  cardType: CardType;
  onClose: () => void;
  onSave?: (data: any) => void;
}

export default function OptionalCards({ cardType, onClose, onSave }: OptionalCardsProps) {
  if (!cardType) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white w-full max-w-lg rounded-t-3xl p-8 pb-12"
          onClick={(e) => e.stopPropagation()}
        >
          {cardType === 'hobby' && <HobbyCard onClose={onClose} onSave={onSave} />}
          {cardType === 'self_desc' && <SelfDescCard onClose={onClose} onSave={onSave} />}
          {cardType === 'zodiac' && <ZodiacCard onClose={onClose} onSave={onSave} />}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Card 1: Hobby / Current State
function HobbyCard({ onClose, onSave }: { onClose: () => void; onSave?: (data: any) => void }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState('');

  const options = [
    { key: 'watch', label: t('optional_cards.hobby_watch') },
    { key: 'walk', label: t('optional_cards.hobby_walk') },
    { key: 'movie', label: t('optional_cards.hobby_movie') },
    { key: 'chat', label: t('optional_cards.hobby_chat') },
    { key: 'alone', label: t('optional_cards.hobby_alone') },
    { key: 'create', label: t('optional_cards.hobby_create') },
    { key: 'learn', label: t('optional_cards.hobby_learn') },
  ];

  const toggleOption = (key: string) => {
    setSelected(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = () => {
    onSave?.({ hobbies: selected, other });
    onClose();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <h3 className="text-2xl font-light text-primary whitespace-pre-line leading-tight">
          {t('optional_cards.hobby_title')}
        </h3>
        <button onClick={onClose} className="p-2 -mr-2 -mt-2 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.key}
            onClick={() => toggleOption(opt.key)}
            className={`px-4 py-2 rounded-full border transition-all text-sm ${
              selected.includes(opt.key)
                ? 'border-primary bg-primary text-white'
                : 'border-gray-200 text-secondary hover:border-gray-400'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={other}
        onChange={(e) => setOther(e.target.value)}
        placeholder={t('optional_cards.hobby_other')}
        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none text-sm"
      />

      <div className="flex gap-3 pt-4">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-secondary text-sm hover:bg-gray-50 transition-colors"
        >
          {t('common.skip')}
        </button>
        <button
          onClick={handleSave}
          disabled={selected.length === 0 && !other.trim()}
          className={`flex-1 py-3 rounded-xl text-sm transition-colors ${
            selected.length > 0 || other.trim()
              ? 'bg-primary text-white hover:bg-black'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
          }`}
        >
          {t('optional_cards.hobby_action')}
        </button>
      </div>
    </div>
  );
}

// Card 2: Self Description
function SelfDescCard({ onClose, onSave }: { onClose: () => void; onSave?: (data: any) => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');

  const handleSave = () => {
    onSave?.({ selfDescription: text });
    onClose();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <h3 className="text-2xl font-light text-primary whitespace-pre-line leading-tight">
          {t('optional_cards.self_desc_title')}
        </h3>
        <button onClick={onClose} className="p-2 -mr-2 -mt-2 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('optional_cards.self_desc_hint')}
          className="w-full h-32 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none text-base resize-none"
          autoFocus
        />
        <p className="text-xs text-muted pl-1">{t('optional_cards.self_desc_hint')}</p>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-secondary text-sm hover:bg-gray-50 transition-colors"
        >
          {t('optional_cards.self_desc_skip')}
        </button>
        <button
          onClick={handleSave}
          disabled={!text.trim()}
          className={`flex-1 py-3 rounded-xl text-sm transition-colors ${
            text.trim()
              ? 'bg-primary text-white hover:bg-black'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
          }`}
        >
          {t('optional_cards.self_desc_save')}
        </button>
      </div>
    </div>
  );
}

// Card 3: Zodiac
function ZodiacCard({ onClose, onSave }: { onClose: () => void; onSave?: (data: any) => void }) {
  const { t } = useLanguage();

  const zodiacSigns = [
    { key: 'aries', label: t('optional_cards.zodiac_aries'), emoji: '♈' },
    { key: 'taurus', label: t('optional_cards.zodiac_taurus'), emoji: '♉' },
    { key: 'gemini', label: t('optional_cards.zodiac_gemini'), emoji: '♊' },
    { key: 'cancer', label: t('optional_cards.zodiac_cancer'), emoji: '♋' },
    { key: 'leo', label: t('optional_cards.zodiac_leo'), emoji: '♌' },
    { key: 'virgo', label: t('optional_cards.zodiac_virgo'), emoji: '♍' },
    { key: 'libra', label: t('optional_cards.zodiac_libra'), emoji: '♎' },
    { key: 'scorpio', label: t('optional_cards.zodiac_scorpio'), emoji: '♏' },
    { key: 'sagittarius', label: t('optional_cards.zodiac_sagittarius'), emoji: '♐' },
    { key: 'capricorn', label: t('optional_cards.zodiac_capricorn'), emoji: '♑' },
    { key: 'aquarius', label: t('optional_cards.zodiac_aquarius'), emoji: '♒' },
    { key: 'pisces', label: t('optional_cards.zodiac_pisces'), emoji: '♓' },
  ];

  const handleSelect = (sign: string) => {
    onSave?.({ zodiac: sign });
    onClose();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h3 className="text-2xl font-light text-primary">
            {t('optional_cards.zodiac_title')}
          </h3>
          <p className="text-sm text-muted">{t('optional_cards.zodiac_subtitle')}</p>
        </div>
        <button onClick={onClose} className="p-2 -mr-2 -mt-2 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {zodiacSigns.map(sign => (
          <button
            key={sign.key}
            onClick={() => handleSelect(sign.key)}
            className="p-3 rounded-xl border border-gray-200 hover:border-primary hover:bg-gray-50 transition-all text-center"
          >
            <span className="text-xl">{sign.emoji}</span>
            <p className="text-xs text-secondary mt-1">{sign.label}</p>
          </button>
        ))}
      </div>

      <button
        onClick={onClose}
        className="w-full py-3 rounded-xl border border-gray-200 text-secondary text-sm hover:bg-gray-50 transition-colors"
      >
        {t('common.skip')}
      </button>
    </div>
  );
}

// Hook to manage optional cards display
export function useOptionalCards() {
  const [currentCard, setCurrentCard] = useState<CardType>(null);
  const [shownCards, setShownCards] = useState<string[]>(() => {
    const saved = localStorage.getItem('seen_shown_cards');
    return saved ? JSON.parse(saved) : [];
  });

  const showNextCard = () => {
    const cardOrder: CardType[] = ['hobby', 'self_desc', 'zodiac'];
    const nextCard = cardOrder.find(card => !shownCards.includes(card!));
    if (nextCard) {
      setCurrentCard(nextCard);
    }
  };

  const markCardAsShown = (card: CardType) => {
    if (card) {
      const newShownCards = [...shownCards, card];
      setShownCards(newShownCards);
      localStorage.setItem('seen_shown_cards', JSON.stringify(newShownCards));
    }
    setCurrentCard(null);
  };

  return {
    currentCard,
    showNextCard,
    closeCard: () => markCardAsShown(currentCard),
    hasUnshownCards: ['hobby', 'self_desc', 'zodiac'].some(c => !shownCards.includes(c)),
  };
}

