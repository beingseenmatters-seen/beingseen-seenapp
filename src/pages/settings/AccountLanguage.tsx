import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';
import type { LoginMethod } from '../../auth';
import { linkGoogleToCurrentUser, linkAppleToCurrentUser, linkEmailToCurrentUser } from '../../auth/linking';
import { isIOS } from '../../auth/platform';

function getLoginMethodLabel(
  method: LoginMethod | undefined,
  providerData: Array<{ providerId: string }> | undefined,
): string {
  if (method) {
    switch (method) {
      case 'google': return 'Google';
      case 'apple': return 'Apple';
      case 'email': return 'Email';
    }
  }
  if (providerData?.length) {
    const pid = providerData[0].providerId;
    if (pid === 'google.com') return 'Google';
    if (pid === 'apple.com') return 'Apple';
    if (pid === 'password' || pid === 'emailLink') return 'Email';
  }
  return '—';
}

export default function AccountLanguage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { firebaseUser, seenUser, signOut, isLoading } = useAuth();

  const loginMethod = getLoginMethodLabel(
    seenUser?.loginMethod,
    firebaseUser?.providerData,
  );
  const email = firebaseUser?.email || seenUser?.email || '—';
  const nickname = seenUser?.nickname;

  const [linkError, setLinkError] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  const providerIds = firebaseUser?.providerData.map(p => p.providerId) || [];
  const hasApple = providerIds.includes('apple.com');
  const hasGoogle = providerIds.includes('google.com');
  const hasEmail = providerIds.includes('password') || providerIds.includes('emailLink');

  const handleLinkGoogle = async () => {
    try {
      setLinkError('');
      setIsLinking(true);
      await linkGoogleToCurrentUser();
      // Force reload to reflect new providers
      window.location.reload();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link Google account');
    } finally {
      setIsLinking(false);
    }
  };

  const handleLinkApple = async () => {
    try {
      setLinkError('');
      setIsLinking(true);
      await linkAppleToCurrentUser();
      window.location.reload();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link Apple account');
    } finally {
      setIsLinking(false);
    }
  };

  const handleLinkEmail = async () => {
    const emailToLink = window.prompt('Enter email to connect:');
    if (!emailToLink) return;
    
    try {
      setLinkError('');
      setIsLinking(true);
      await linkEmailToCurrentUser(emailToLink);
      alert('Verification link sent! Please check your email.');
    } catch (err: any) {
      setLinkError(err.message || 'Failed to send email link');
    } finally {
      setIsLinking(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      console.log('[Account] User signed out successfully');
    } catch (err) {
      console.error('[Account] Sign out failed:', err);
    }
  };

  if (!firebaseUser && isLoading) {
    return (
      <div className="h-full bg-white flex items-center justify-center">
        <span className="text-sm font-light text-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-secondary hover:text-primary transition-colors">
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">{t('settings.account.header')}</span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 space-y-10">
          <div className="pt-2 pb-2">
            <h1 className="text-2xl font-light text-primary mb-3">{t('settings.account.title')}</h1>
          </div>

          {/* Account info */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">{t('settings.account.module_b_title')}</h3>
            <div className="bg-gray-50 rounded-2xl p-4 space-y-4">
              {nickname && (
                <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                  <span className="text-sm text-secondary">{t('settings.profile.field_nickname')}</span>
                  <span className="text-sm font-medium text-primary">{nickname}</span>
                </div>
              )}
              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-sm text-secondary">Email</span>
                <span className="text-sm font-medium text-primary truncate max-w-[200px]">{email}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-sm text-secondary">{t('settings.account.current_method')}</span>
                <span className="text-sm font-medium text-primary">{loginMethod}</span>
              </div>
            </div>
          </section>

          {/* Login Methods */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-1">Login Methods</h3>
            <div className="bg-gray-50 rounded-2xl p-4 space-y-4">
              {linkError && (
                <div className="text-sm text-red-500 pb-2">
                  {linkError}
                </div>
              )}
              
              {/* Apple */}
              {isIOS() && (
                <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                  <span className="text-sm text-secondary">Apple</span>
                  {hasApple ? (
                    <span className="text-sm font-medium text-green-600">Connected</span>
                  ) : (
                    <button 
                      onClick={handleLinkApple}
                      disabled={isLinking}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      Connect
                    </button>
                  )}
                </div>
              )}

              {/* Google */}
              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-sm text-secondary">Google</span>
                {hasGoogle ? (
                  <span className="text-sm font-medium text-green-600">Connected</span>
                ) : (
                  <button 
                    onClick={handleLinkGoogle}
                    disabled={isLinking}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    Connect
                  </button>
                )}
              </div>

              {/* Email */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-secondary">Email</span>
                {hasEmail ? (
                  <span className="text-sm font-medium text-green-600">Connected</span>
                ) : (
                  <button 
                    onClick={handleLinkEmail}
                    disabled={isLinking}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Actions */}
          <section className="space-y-4 pt-4">
            <button
              onClick={handleSignOut}
              disabled={isLoading}
              className="w-full py-4 bg-gray-50 rounded-xl text-sm text-primary hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {isLoading ? t('common.loading') : t('settings.account.action_logout')}
            </button>
            <button
              disabled
              className="w-full py-4 text-sm text-gray-300 cursor-not-allowed"
            >
              {t('settings.account.action_delete')}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{t('common.feature_coming_soon')}</span>
            </button>
          </section>

        </div>
      </div>
    </div>
  );
}
