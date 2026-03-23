import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { formatInsightTag } from '../services/userSummary';
import { useAuth } from '../auth/AuthContext';
import { getResonateCandidate, sendConnectionRequest } from '../services/connections';
import type { CandidateProfile } from '../services/connections';

export default function Resonate() {
  const { t, effectiveLanguage } = useLanguage();
  const { firebaseUser } = useAuth();

  const [candidate, setCandidate] = useState<CandidateProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [step, setStep] = useState(0); // 0: Not Ready / Empty, 1: Candidate, 2: Confirm, 3: Waiting
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    async function fetchCandidate() {
      if (!firebaseUser?.uid) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const found = await getResonateCandidate(firebaseUser.uid);
      setCandidate(found);
      if (found) {
        setStep(1);
      } else {
        setStep(0);
      }
      setIsLoading(false);
    }
    fetchCandidate();
  }, [firebaseUser?.uid]);

  const fadeIn = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { duration: 0.5, ease: 'easeOut' as const }
  };

  const profile = candidate?.soulProfile?.reflectModel || candidate?.soulProfile?.latestInsight;
  const hasProfile = Boolean(profile);

  const sourceTag = effectiveLanguage === 'zh' ? '同频推荐' : 'Resonance Match';

  const profileTitle = effectiveLanguage === 'zh'
        ? `发现了一个与你思考频率相似的人。`
        : `Found someone whose thinking resonates with yours.`;

  const profileSubtitle = effectiveLanguage === 'zh'
        ? '基于你们的 Reflect 总结，你们在某些深层认知上有着奇妙的共鸣。'
        : 'Based on your Reflect summaries, you share a fascinating alignment in deeper cognition.';

  const formatValue = (value: string | undefined, fallback: string) => {
    if (!value) return fallback;
    return formatInsightTag(value, effectiveLanguage === 'zh' ? 'zh' : 'en');
  };

  const dimensions = profile ? [
    {
      label: effectiveLanguage === 'zh' ? '思考方式' : 'Thinking Style',
      value: formatValue(profile.thinkingStyle?.[0], effectiveLanguage === 'zh' ? '哲学式推理' : 'Philosophical reasoning'),
    },
    {
      label: effectiveLanguage === 'zh' ? '核心问题' : 'Core Question',
      value: formatValue(profile.coreQuestions?.[0], effectiveLanguage === 'zh' ? '什么决定关系能否长久' : 'What makes relationships endure'),
    },
    {
      label: effectiveLanguage === 'zh' ? '世界观' : 'Worldview',
      value: formatValue(profile.worldview?.[0], effectiveLanguage === 'zh' ? '人心难以被精确测量' : 'Human hearts resist measurement'),
    },
    {
      label: effectiveLanguage === 'zh' ? '关系哲学' : 'Relationship Philosophy',
      value: formatValue(profile.relationshipPhilosophy?.[0], effectiveLanguage === 'zh' ? '关系更依赖认知同频而非强烈情绪' : 'Alignment matters more than intensity'),
    },
    {
      label: effectiveLanguage === 'zh' ? '对话风格' : 'Conversation Style',
      value: formatValue(profile.conversationStyle?.[0], effectiveLanguage === 'zh' ? '概念驱动的对话' : 'Concept-driven dialogue'),
    },
  ] : [];

  const handleNotNow = () => {
    setStep(0);
  };

  const handleSendRequest = async () => {
    console.log('[Resonate] handleSendRequest clicked. Current UID:', firebaseUser?.uid, 'Candidate UID:', candidate?.uid);
    if (!firebaseUser?.uid || !candidate) {
      console.warn('[Resonate] Missing UID or candidate. Aborting.');
      return;
    }
    setIsSending(true);
    const success = await sendConnectionRequest(firebaseUser.uid, candidate.uid);
    console.log('[Resonate] sendConnectionRequest returned:', success);
    setIsSending(false);
    if (success) {
      console.log('[Resonate] Transitioning to success state (step 3)');
      setStep(3);
    } else {
      console.log('[Resonate] Request failed or duplicate. Resetting to step 0');
      // If failed or duplicate, just go back to empty for now
      setStep(0);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-gray-300 mb-4" size={32} />
        <p className="text-sm text-muted font-light">
          {effectiveLanguage === 'zh' ? '正在寻找同频的人...' : 'Finding resonance...'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('nav.resonate')}
        </span>
      </div>
      <div className="flex-1 min-h-0 px-6 pb-8 flex flex-col overflow-y-auto no-scrollbar">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="step0" {...fadeIn} className="flex-1 flex flex-col justify-center items-center text-center space-y-8">
            <div className="space-y-4">
              <h2 className="text-3xl font-light text-primary whitespace-pre-line">
                {hasProfile ? t('resonate.empty_title') : t('resonate.step0_title')}
              </h2>
              <p className="text-secondary font-light max-w-xs whitespace-pre-line">
                {hasProfile ? t('resonate.empty_desc') : t('resonate.step0_desc')}
              </p>
              {!hasProfile && (
                <p className="text-[10px] text-muted pt-2 max-w-xs leading-relaxed">
                  {effectiveLanguage === 'zh'
                    ? '先在 Reflect 里完成几次你认可的总结，Resonate 才会更准确地理解你。'
                    : 'Complete a few approved summaries in Reflect first, so Resonate can understand you more accurately.'}
                </p>
              )}
              {hasProfile && <p className="text-[10px] text-muted pt-2">{t('resonate.empty_note')}</p>}
            </div>
            <div className="space-y-4 w-full max-w-xs pt-8">
              <Link to="/" className="block w-full py-4 rounded-xl bg-primary text-white text-center hover:bg-black transition-colors">
                {t('resonate.action_continue')}
              </Link>
            </div>
          </motion.div>
        )}

        {step === 1 && profile && (
          <motion.div key="step1" {...fadeIn} className="flex-1 flex flex-col h-full">
            <div className="flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex flex-col justify-between mb-6">
              <div>
                <div className="mb-6">
                  <span className="inline-block px-3 py-1 rounded-full bg-gray-50 text-xs font-medium text-secondary tracking-wide mb-2">
                    {sourceTag}
                  </span>
                  <h2 className="text-2xl font-medium text-primary leading-tight">
                    {profileTitle}
                  </h2>
                  <p className="mt-4 text-sm text-muted font-light leading-relaxed">
                    {profileSubtitle}
                  </p>
                </div>

                <div className="space-y-6">
                  {dimensions.map(d => (
                    <Dimension key={d.label} label={d.label} value={d.value} />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setStep(2)}
                className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
              >
                {t('resonate.action_request')}
              </button>
              <button
                onClick={handleNotNow}
                className="w-full py-4 rounded-2xl text-muted text-sm hover:text-secondary transition-colors"
              >
                {t('common.not_now')}
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" {...fadeIn} className="flex-1 flex flex-col justify-center items-center text-center space-y-8 px-4">
            <h2 className="text-2xl font-light text-primary">{t('resonate.confirm_title')}</h2>
            <p className="text-secondary font-light whitespace-pre-line">
              {t('resonate.confirm_desc')}
            </p>
            <div className="flex w-full space-x-4 pt-8">
              <button
                onClick={() => setStep(1)}
                disabled={isSending}
                className="flex-1 py-4 rounded-xl border border-gray-200 text-secondary hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSendRequest}
                disabled={isSending}
                className="flex-1 py-4 rounded-xl bg-primary text-white hover:bg-black transition-colors disabled:opacity-50 flex justify-center items-center"
              >
                {isSending ? <Loader2 className="animate-spin" size={20} /> : t('resonate.action_send_request')}
              </button>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" {...fadeIn} className="flex-1 flex flex-col justify-center items-center text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4 text-primary">
              <Check size={24} />
            </div>
            <h2 className="text-xl font-light text-primary">{t('resonate.waiting_title')}</h2>
            <p className="text-secondary font-light max-w-xs whitespace-pre-line">
              {t('resonate.waiting_desc')}
            </p>
            <Link to="/inbox" className="text-sm text-primary underline underline-offset-4 mt-8">
              {t('resonate.action_goto_inbox')}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

function Dimension({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-xs text-muted uppercase tracking-wider">{label}</span>
      <span className="text-base text-primary font-light">{value}</span>
    </div>
  );
}
