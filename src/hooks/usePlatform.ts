import { useState, useEffect } from 'react';
import { isWeb, isNative, isIOS, isAndroid, getPlatform } from '../auth/platform';

export function usePlatform() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    isWeb: isWeb(),
    isNative: isNative(),
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    platform: getPlatform(),
    windowWidth,
    isDesktop: isWeb() && windowWidth >= 768,
    isMobileWeb: isWeb() && windowWidth < 768,
  };
}
