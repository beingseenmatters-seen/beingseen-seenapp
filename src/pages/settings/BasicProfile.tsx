import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';

function normalizeProfileForCompare(profile: any) {
  return {
    nickname: (profile.nickname || '').trim(),
    age: profile.age || '',
    location: (profile.location || '').trim(),
    gender: profile.gender || '',
    zodiac: profile.zodiac || '',
    currentState: profile.currentState || '',
    interests: profile.interests || []
  };
}

export default function BasicProfile() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { seenUser, updateProfile } = useAuth();

  const initialUser = useMemo(() => seenUser?.basic || {}, [seenUser]);
  const [nickname, setNickname] = useState(initialUser.nickname || '');
  const [age, setAge] = useState(initialUser.age || '');
  const [location, setLocation] = useState(initialUser.location || '');
  const [gender, setGender] = useState(initialUser.gender || '');
  const [zodiac, setZodiac] = useState(initialUser.zodiac || '');
  const [currentState, setCurrentState] = useState(initialUser.currentState || '');
  const [interests, setInterests] = useState<string[]>(initialUser.interests || []);
  const [customInterest, setCustomInterest] = useState('');

  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(normalizeProfileForCompare(initialUser))
  );

  const isDirty = useMemo(() => {
    const current = normalizeProfileForCompare({ nickname, age, location, gender, zodiac, currentState, interests });
    return JSON.stringify(current) !== savedSnapshot;
  }, [nickname, age, location, gender, zodiac, currentState, interests, savedSnapshot]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const ageOptions = [
    { value: '18-24', label: t('onboarding.age_18_24') },
    { value: '25-34', label: t('onboarding.age_25_34') },
    { value: '35-44', label: t('onboarding.age_35_44') },
    { value: '45-54', label: t('onboarding.age_45_54') },
    { value: '55+', label: t('onboarding.age_55_plus') }
  ];

  const genderOptions = [
    { id: 'female', label: t('settings.profile.gender.female') },
    { id: 'male', label: t('settings.profile.gender.male') },
    { id: 'non_binary', label: t('settings.profile.gender.non_binary') },
    { id: 'prefer_not', label: t('settings.profile.gender.prefer_not') }
  ];

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
    { key: 'pisces', label: t('optional_cards.zodiac_pisces'), emoji: '♓' }
  ];

  const currentStateOptions = [
    { value: 'looking_for_connection', labelKey: 'onboarding.state_connection' },
    { value: 'healing_or_processing', labelKey: 'onboarding.state_healing' },
    { value: 'space_to_talk', labelKey: 'onboarding.state_talk' },
    { value: 'unsure', labelKey: 'onboarding.state_unsure' },
  ];

  const presetInterests = [
    'reading', 'outdoors', 'fitness', 'travel', 'shows', 'music', 
    'movies', 'food', 'photography', 'gaming', 'pets', 'art', 
    'writing', 'meditation'
  ];

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
    
    const nextBasic = {
      nickname: nickname.trim(),
      age,
      location: location.trim(),
      gender,
      zodiac,
      currentState,
      interests
    };

    try {
      await updateProfile({
        basic: nextBasic,
        nickname: nextBasic.nickname // keep top-level nickname in sync for now if needed
      });
      
      setSavedSnapshot(JSON.stringify(normalizeProfileForCompare(nextBasic)));
      setToast(t('common.saved'));
      console.log('User profile saved:', { basic: nextBasic });
    } catch (error) {
      console.error('Failed to save profile:', error);
      setToast('Error saving profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>

          <span className="text-sm font-medium tracking-widest text-muted uppercase">
            {t('settings.profile.header')}
          </span>

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

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 space-y-10">
          <div className="pt-2">
            <h1 className="text-2xl font-light text-primary mb-2">{t('settings.profile.title')}</h1>
            <p className="text-secondary font-light text-sm leading-relaxed whitespace-pre-line">
              {language === 'zh'
                ? '这些信息只用于你自己的体验。\n你可以随时修改。'
                : 'These are for your own experience.\nYou can edit anytime.'}
            </p>
          </div>

          {/* Nickname */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('settings.profile.field_nickname')}
            </h3>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('onboarding.q1_placeholder')}
              className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light"
            />
          </section>

          {/* Age */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('settings.profile.field_age')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {ageOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setAge(opt.value)}
                  className={clsx(
                    'p-4 rounded-2xl border transition-all text-center',
                    age === opt.value
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary'
                  )}
                >
                  <span className="text-sm font-light">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Current State */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('onboarding.current_state')}
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {currentStateOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCurrentState(opt.value)}
                  className={clsx(
                    'p-4 rounded-2xl border transition-all text-left',
                    currentState === opt.value
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary'
                  )}
                >
                  <span className="text-sm font-light">{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Interests */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('onboarding.interests_title')}
            </h3>
            <p className="text-xs text-secondary font-light pl-1">
              {t('onboarding.interests_hint')}
            </p>
            <div className="flex flex-wrap gap-2">
              {presetInterests.map((key) => {
                const isSelected = interests.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (isSelected) {
                        setInterests(interests.filter(i => i !== key));
                      } else {
                        setInterests([...interests, key]);
                      }
                    }}
                    className={clsx(
                      'px-4 py-2 rounded-full border text-sm transition-all',
                      isSelected
                        ? 'border-primary bg-primary text-white'
                        : 'border-gray-200 hover:border-primary text-primary bg-white'
                    )}
                  >
                    {t(`onboarding.interest_opt.${key}`)}
                  </button>
                );
              })}
              {/* Custom interests already added */}
              {interests.filter(i => !presetInterests.includes(i)).map(custom => (
                <button
                  key={custom}
                  onClick={() => setInterests(interests.filter(i => i !== custom))}
                  className="px-4 py-2 rounded-full border border-primary bg-primary text-white text-sm transition-all flex items-center gap-1"
                >
                  <span>{custom.replace(/^other:/, '')}</span>
                  <span className="text-white/70 ml-1">×</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customInterest.trim()) {
                    e.preventDefault();
                    const val = `other:${customInterest.trim()}`;
                    if (!interests.includes(val)) {
                      setInterests([...interests, val]);
                    }
                    setCustomInterest('');
                  }
                }}
                placeholder={t('onboarding.interests_other_placeholder')}
                className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none text-sm font-light"
              />
              <button
                onClick={() => {
                  if (customInterest.trim()) {
                    const val = `other:${customInterest.trim()}`;
                    if (!interests.includes(val)) {
                      setInterests([...interests, val]);
                    }
                    setCustomInterest('');
                  }
                }}
                disabled={!customInterest.trim()}
                className="px-4 py-2 bg-gray-100 text-primary rounded-xl text-sm disabled:opacity-50"
              >
                +
              </button>
            </div>
          </section>

          {/* Location */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('settings.profile.field_location')}
            </h3>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={language === 'zh' ? '例如：上海 / Sydney（可不填）' : 'e.g. Shanghai / Sydney (Optional)'}
              className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light"
            />
          </section>

          {/* Gender */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('settings.profile.field_gender')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {genderOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setGender(gender === opt.id ? '' : opt.id)}
                  className={clsx(
                    'p-4 rounded-2xl border transition-all text-center',
                    gender === opt.id
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary'
                  )}
                >
                  <span className="text-sm font-light">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Zodiac */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">
              {t('settings.profile.field_zodiac')}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {zodiacSigns.map((sign) => (
                <button
                  key={sign.key}
                  onClick={() => setZodiac(zodiac === sign.key ? '' : sign.key)}
                  className={clsx(
                    'p-3 rounded-xl border transition-all text-center',
                    zodiac === sign.key
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary'
                  )}
                >
                  <span className="text-xl">{sign.emoji}</span>
                  <p className={clsx('text-xs mt-1', zodiac === sign.key ? 'text-gray-200' : 'text-secondary')}>
                    {sign.label}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}


