import { useState, createContext, useContext, useEffect, type ReactNode } from 'react';
import { Device } from '@capacitor/device';
import zh from './zh.json';
import en from './en.json';

export type Language = 'zh' | 'en' | 'auto';

// Safe translation access helper
function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let result: any = obj;
  for (const key of keys) {
    result = result?.[key];
    if (result === undefined) return path;
  }
  return result;
}

// Context
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string) => any;
  effectiveLanguage: 'zh' | 'en';
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    // Check localStorage first
    const saved = localStorage.getItem('seen_language') as Language;
    return (saved === 'zh' || saved === 'en' || saved === 'auto') ? saved : 'auto';
  });

  const [deviceLang, setDeviceLang] = useState<string>('');

  useEffect(() => {
    const fetchDeviceLang = async () => {
      try {
        const info = await Device.getLanguageCode();
        console.log('[i18n] Device language code:', info.value);
        setDeviceLang(info.value.toLowerCase());
      } catch (err) {
        console.error('[i18n] Failed to get device language:', err);
      }
    };
    fetchDeviceLang();
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('seen_language', lang);
    // Ideally update backend user profile here
  };

  const getEffectiveLanguage = (lang: Language): 'zh' | 'en' => {
    if (lang === 'auto') {
      if (deviceLang) {
        return deviceLang.startsWith('zh') ? 'zh' : 'en';
      }
      const systemLangs = navigator.languages || [navigator.language];
      const primaryLang = (systemLangs[0] || '').toLowerCase();
      // Check for zh-CN, zh-TW, etc.
      return primaryLang.startsWith('zh') ? 'zh' : 'en';
    }
    return lang;
  };

  const effectiveLanguage = getEffectiveLanguage(language);

  const t = (path: string): any => {
    const dict = effectiveLanguage === 'zh' ? zh : en;
    return getNestedValue(dict, path);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, effectiveLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Hook
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

