import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';

interface QuestionAnswer {
  [key: string]: string;
}

const STORAGE_KEY = 'seen_my_questions';

function readAnswers(): QuestionAnswer {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as QuestionAnswer) : {};
  } catch {
    return {};
  }
}

export default function MyQuestions() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const questions = useMemo(
    () => [
      { key: 'q1', title: t('me_questions.q1_title') },
      { key: 'q2', title: t('me_questions.q2_title') },
      { key: 'q3', title: t('me_questions.q3_title') },
      { key: 'q4', title: t('me_questions.q4_title') },
      { key: 'q5', title: t('me_questions.q5_title') },
      { key: 'q6', title: t('me_questions.q6_title') }
    ],
    [t]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer>(() => readAnswers());
  const currentQuestion = questions[currentIndex];

  const [currentText, setCurrentText] = useState(answers[currentQuestion.key] || '');
  const [toast, setToast] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(answers));

  const isDirty = useMemo(() => JSON.stringify(answers) !== savedSnapshot, [answers, savedSnapshot]);

  useEffect(() => {
    setCurrentText(answers[currentQuestion.key] || '');
  }, [currentQuestion.key, answers]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const handleBack = () => {
    if (isDirty) {
      const ok = confirm(t('common.unsaved_confirm'));
      if (!ok) return;
    }
    navigate(-1);
  };

  const handleSaveAll = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    setSavedSnapshot(JSON.stringify(answers));
    setToast(t('common.saved'));
    console.log('[MyQuestions] saved', { keys: Object.keys(answers).length });
  };

  const handleTextChange = (text: string) => {
    setCurrentText(text);
    setAnswers((prev) => ({ ...prev, [currentQuestion.key]: text }));
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const goNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      navigate('/me');
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Top Nav: Back / Title / Save */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0">
          <button onClick={handleBack} className="p-2 -ml-2 text-secondary hover:text-primary transition-colors" aria-label={t('common.back')}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">{t('me.menu_questions')}</span>
          <button
            onClick={handleSaveAll}
            disabled={!isDirty}
            className={clsx(
              'text-sm font-medium px-2 py-1 rounded-md transition-colors',
              isDirty ? 'text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            )}
          >
            {t('common.save')}
          </button>
        </div>

        {toast && (
          <div className="absolute top-16 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className="px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs shadow-lg">
              {toast}
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-28 space-y-6">
          {/* Progress */}
          <div className="pt-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted uppercase tracking-widest">
                {currentIndex + 1} / {questions.length}
              </span>
              <span className="text-xs text-muted">
                {language === 'zh' ? '可随时保存' : 'Save anytime'}
              </span>
            </div>
            <div className="flex gap-1.5">
              {questions.map((_, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'h-1 flex-1 rounded-full transition-colors',
                    idx <= currentIndex ? 'bg-primary' : 'bg-gray-200'
                  )}
                />
              ))}
            </div>
          </div>

          {/* Intro */}
          {currentIndex === 0 && (
            <p className="text-sm text-muted font-light whitespace-pre-line leading-relaxed">
              {t('me_questions.intro')}
            </p>
          )}

          {/* Question */}
          <div className="space-y-4">
            <h2 className="text-2xl font-light text-primary whitespace-pre-line leading-relaxed">
              {currentQuestion.title}
            </h2>
            <textarea
              value={currentText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="..."
              className="w-full p-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light resize-none min-h-[200px]"
            />
          </div>

          <p className="text-xs text-muted text-center whitespace-pre-line leading-relaxed pt-4">
            {t('me_questions.footer')}
          </p>
        </div>

        {/* Question Navigation (fixed) */}
        <div
          className="absolute left-0 right-0 bottom-0 bg-white/95 backdrop-blur-md border-t border-gray-100 px-6 pt-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <div className="flex gap-3">
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className={clsx(
                'flex-1 py-3 rounded-xl border text-sm transition-colors',
                currentIndex === 0
                  ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                  : 'border-gray-200 text-secondary hover:bg-gray-50'
              )}
            >
              {t('common.back')}
            </button>
            <button
              onClick={goNext}
              className="flex-1 py-3 rounded-xl bg-primary text-white text-sm hover:bg-black transition-colors flex items-center justify-center gap-2"
            >
              {currentIndex < questions.length - 1 ? t('common.next') : t('common.done')}
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

