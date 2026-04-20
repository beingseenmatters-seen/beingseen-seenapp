import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';

// Custom smooth slider component with drag support
function SmoothSlider({ 
  value, 
  onChange, 
  labels 
}: { 
  value: number; 
  onChange: (v: number) => void; 
  labels: string[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateValue = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    onChange(Math.round(percent));
  }, [onChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    updateValue(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    updateValue(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      updateValue(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      updateValue(e.touches[0].clientX);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, updateValue]);

  return (
    <div className="space-y-4 select-none">
      {/* Track */}
      <div 
        ref={trackRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="relative h-8 cursor-pointer touch-pan-x"
      >
        {/* Background track */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-2 bg-gray-200 rounded-full" />
        
        {/* Filled track */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 h-2 bg-primary rounded-full transition-all duration-75"
          style={{ width: `${value}%` }}
        />
        
        {/* Thumb */}
        <div 
          className={clsx(
            "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white border-2 border-primary rounded-full shadow-md transition-transform",
            isDragging && "scale-110"
          )}
          style={{ left: `${value}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between text-xs text-secondary font-light">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}

export default function AIResponse() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { seenUser, updateProfile } = useAuth();

  const initialPref = useMemo(() => seenUser?.soulProfile?.aiPreference || {}, [seenUser]);

  const [role, setRole] = useState(initialPref.role || 'mirror');
  const [intensity, setIntensity] = useState(initialPref.intensity ?? 50);
  const [emotionHandling, setEmotionHandling] = useState(initialPref.emotionHandling || 'context');

  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify({ role: initialPref.role || 'mirror', intensity: initialPref.intensity ?? 50, emotionHandling: initialPref.emotionHandling || 'context' })
  );

  const isDirty = useMemo(() => {
    return JSON.stringify({ role, intensity, emotionHandling }) !== savedSnapshot;
  }, [role, intensity, emotionHandling, savedSnapshot]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const roles = [
    { id: 'mirror', icon: '🪞', title: t('settings.ai_response.roles.mirror.title'), desc: t('settings.ai_response.roles.mirror.desc') },
    { id: 'organizer', icon: '🧭', title: t('settings.ai_response.roles.organizer.title'), desc: t('settings.ai_response.roles.organizer.desc') },
    { id: 'helper', icon: '🗣', title: t('settings.ai_response.roles.helper.title'), desc: t('settings.ai_response.roles.helper.desc') },
    { id: 'guide', icon: '🧑‍🏫', title: t('settings.ai_response.roles.guide.title'), desc: t('settings.ai_response.roles.guide.desc') },
  ];

  const emotionOptions = [
    { id: 'comfort', icon: '🕊', title: t('settings.ai_response.emotions.comfort') },
    { id: 'analyze', icon: '🧠', title: t('settings.ai_response.emotions.analyze') },
    { id: 'context', icon: '⚖️', title: t('settings.ai_response.emotions.context') },
  ];

  const intensityLabels = t('settings.ai_response.intensity_labels') as unknown as string[];

  const handleBack = () => {
    if (isDirty) {
      const ok = confirm(t('common.unsaved_confirm'));
      if (!ok) return;
    }
    navigate(-1);
  };

  const handleSave = async () => {
    if (!isDirty) return;
    setIsSaving(true);
    
    const next = {
      ...seenUser?.soulProfile?.aiPreference,
      role,
      intensity,
      emotionHandling,
    };

    try {
      await updateProfile({
        soulProfile: { aiPreference: next },
      });
      
      setSavedSnapshot(JSON.stringify(next));
      setToast(t('common.saved'));
      console.log('User profile saved:', { soulProfile: { aiPreference: next } });
    } catch (error) {
      console.error('Failed to save AI preferences:', error);
      setToast('Error saving preferences');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button onClick={handleBack} className="p-2 -ml-2 text-secondary hover:text-primary transition-colors" aria-label={t('common.back')}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">{t('settings.ai_response.header')}</span>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={clsx(
              'text-sm font-medium px-2 py-1 rounded-md transition-colors',
              isDirty && !isSaving ? 'text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            )}
          >
            {isSaving ? '...' : t('common.save')}
          </button>
        </div>

        {toast && (
          <div className="absolute top-16 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className="px-3 py-1.5 rounded-full bg-gray-900 text-white text-xs shadow-lg">
              {toast}
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-10">
          <div className="pt-2 pb-2">
            <h1 className="text-2xl font-light text-primary mb-3">{t('settings.ai_response.title')}</h1>
            <p className="text-secondary font-light text-sm leading-relaxed whitespace-pre-line">
              {t('settings.ai_response.desc')}
            </p>
          </div>

          {/* Module A: AI Role */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-primary">{t('settings.ai_response.module_a_title')}</h3>
            <div className="grid grid-cols-1 gap-3">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRole(r.id)}
                  className={clsx(
                    "flex items-center p-4 rounded-xl border text-left transition-all duration-200",
                    role === r.id 
                      ? "border-primary bg-primary text-white" 
                      : "border-gray-100 bg-white text-primary hover:border-gray-300"
                  )}
                >
                  <span className="text-2xl mr-4">{r.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className={clsx("text-xs mt-0.5", role === r.id ? "text-gray-300" : "text-muted")}>
                      {r.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted font-light pt-2">
              {t('settings.ai_response.module_a_note')}
            </p>
          </section>

          {/* Module B: Suggestion Intensity - Using custom smooth slider */}
          <section className="space-y-6">
            <div className="space-y-1">
               <h3 className="text-sm font-medium text-primary">{t('settings.ai_response.module_b_title')}</h3>
            </div>
            
            <div className="px-1">
              <SmoothSlider
                value={intensity}
                onChange={setIntensity}
                labels={intensityLabels}
              />
            </div>
            <p className="text-xs text-muted font-light pt-2">
              {t('settings.ai_response.module_b_note')}
            </p>
          </section>

          {/* Module C: Emotion Handling */}
          <section className="space-y-4">
             <h3 className="text-sm font-medium text-primary">{t('settings.ai_response.module_c_title')}</h3>
             <div className="grid grid-cols-3 gap-3">
               {emotionOptions.map((opt) => (
                 <button
                   key={opt.id}
                   onClick={() => setEmotionHandling(opt.id)}
                   className={clsx(
                     "flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all duration-200 h-24",
                     emotionHandling === opt.id
                       ? "border-primary bg-primary text-white" 
                       : "border-gray-100 bg-white text-primary hover:border-gray-300"
                   )}
                 >
                   <span className="text-xl mb-2">{opt.icon}</span>
                   <span className="text-xs leading-tight">{opt.title}</span>
                 </button>
               ))}
             </div>
          </section>

          {/* Bottom spacer for sticky button */}
          <div className="pb-20" />
        </div>

        {/* Sticky Save Button at bottom - always visible */}
        <div className="shrink-0 sticky bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100 safe-area-inset-bottom">
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
            {isSaving ? '...' : t('settings.ai_response.action_save')}
          </button>
        </div>
      </div>
    </div>
  );
}
