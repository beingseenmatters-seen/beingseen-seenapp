import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { formatInsightTag, readBestAvailableMatchingProfile } from '../services/userSummary';

export default function Resonate() {
  const { t, effectiveLanguage } = useLanguage();

  const matchingProfile = useMemo(() => readBestAvailableMatchingProfile(), []);
  const hasProfile = Boolean(matchingProfile.profile);
  const [step, setStep] = useState(hasProfile ? 1 : 0); // 0: Not Ready / Empty, 1: Candidate, 2: Confirm, 3: Waiting

  const fadeIn = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { duration: 0.5, ease: 'easeOut' as const }
  };

  const profile = matchingProfile.profile;
  const sourceTag = matchingProfile.source === 'aggregated_model'
    ? (effectiveLanguage === 'zh' ? '长期理解模型' : 'Long-term Understanding')
    : (effectiveLanguage === 'zh' ? '已确认总结' : 'Approved Insight');

  const profileTitle = matchingProfile.source === 'aggregated_model'
    ? (effectiveLanguage === 'zh'
        ? `基于 ${matchingProfile.insightCount} 次已认可总结，我们看见了一些更稳定的思考轮廓。`
        : `Based on ${matchingProfile.insightCount} approved reflections, a more stable way of thinking is emerging.`)
    : (effectiveLanguage === 'zh'
        ? '你的思考轮廓，已经开始变得清晰。'
        : 'The outline of how you think is beginning to come into focus.');

  const profileSubtitle = matchingProfile.source === 'aggregated_model'
    ? (effectiveLanguage === 'zh'
        ? '同频匹配会优先参考这些长期稳定的思考方式，而不是已清除的原始聊天内容。'
        : 'Matching now prioritizes these longer-term thinking patterns, not cleared raw chats.')
    : (effectiveLanguage === 'zh'
        ? '目前仍以已确认的单次总结为主，随着更多总结累积，会形成更稳定的长期理解。'
        : 'For now this is based on approved session summaries. As more are confirmed, a more stable long-term understanding model will form.');

  const formatValue = (value: string | undefined, fallback: string) => {
    if (!value) return fallback;
    return formatInsightTag(value, effectiveLanguage === 'zh' ? 'zh' : 'en');
  };

  const dimensions = [
    {
      label: effectiveLanguage === 'zh' ? '思考方式' : 'Thinking Style',
      value: formatValue(profile?.thinkingStyle[0], effectiveLanguage === 'zh' ? '哲学式推理' : 'Philosophical reasoning'),
    },
    {
      label: effectiveLanguage === 'zh' ? '核心问题' : 'Core Question',
      value: formatValue(profile?.coreQuestions[0], effectiveLanguage === 'zh' ? '什么决定关系能否长久' : 'What makes relationships endure'),
    },
    {
      label: effectiveLanguage === 'zh' ? '世界观' : 'Worldview',
      value: formatValue(profile?.worldview[0], effectiveLanguage === 'zh' ? '人心难以被精确测量' : 'Human hearts resist measurement'),
    },
    {
      label: effectiveLanguage === 'zh' ? '关系哲学' : 'Relationship Philosophy',
      value: formatValue(profile?.relationshipPhilosophy[0], effectiveLanguage === 'zh' ? '关系更依赖认知同频而非强烈情绪' : 'Alignment matters more than intensity'),
    },
    {
      label: effectiveLanguage === 'zh' ? '对话风格' : 'Conversation Style',
      value: formatValue(profile?.conversationStyle[0], effectiveLanguage === 'zh' ? '概念驱动的对话' : 'Concept-driven dialogue'),
    },
  ];

  const handleNotNow = () => {
    setStep(0);
  };

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
            <p className="text-[10px] text-center text-muted mt-4">
              {effectiveLanguage === 'zh'
                ? `当前理解来源：${matchingProfile.source === 'aggregated_model' ? '长期聚合模型' : '已确认单次总结'} · ${matchingProfile.insightCount} 条`
                : `Current source: ${matchingProfile.source === 'aggregated_model' ? 'aggregated model' : 'approved summaries'} · ${matchingProfile.insightCount} insight(s)`}
            </p>
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
                className="flex-1 py-4 rounded-xl border border-gray-200 text-secondary hover:bg-gray-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-4 rounded-xl bg-primary text-white hover:bg-black transition-colors"
              >
                {t('resonate.action_send_request')}
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
