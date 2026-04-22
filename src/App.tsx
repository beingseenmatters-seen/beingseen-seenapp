import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { usePushNotifications } from './hooks/usePushNotifications';
import AppLayout from './layouts/AppLayout';
import Reflect from './pages/Reflect';
import Resonate from './pages/Resonate';
import Inbox from './pages/Inbox';
import Me from './pages/Me';
import Onboarding from './pages/Onboarding';
import WelcomeScreen from './pages/auth/WelcomeScreen';
import AuthOptionsScreen from './pages/auth/AuthOptionsScreen';
import EmailInputScreen from './pages/auth/EmailInputScreen';
import EmailLinkWaitingScreen from './pages/auth/EmailLinkWaitingScreen';
import Understanding from './pages/settings/Understanding';
import AIResponse from './pages/settings/AIResponse';
import PrivacyData from './pages/settings/PrivacyData';
import AccountLanguage from './pages/settings/AccountLanguage';
import MyQuestions from './pages/settings/MyQuestions';
import AboutMeOptional from './pages/settings/AboutMeOptional';
import BasicProfile from './pages/settings/BasicProfile';
import DeleteAccount from './pages/DeleteAccount';

function SplashScreen() {
  return (
    <div className="h-full bg-white flex items-center justify-center">
      <span className="text-2xl font-light text-muted tracking-widest uppercase">
        Seen
      </span>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full bg-white flex flex-col items-center justify-center px-8 text-center space-y-4">
          <span className="text-2xl font-light text-primary tracking-widest uppercase">
            Seen
          </span>
          <p className="text-sm text-secondary font-light">
            Something went wrong. Please restart the app.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/';
            }}
            className="px-6 py-3 rounded-2xl bg-primary text-white text-sm font-light hover:bg-black transition-colors"
          >
            Reload
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 text-left text-[10px] text-red-500 bg-red-50 p-3 rounded-lg max-w-full overflow-auto">
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

function AppRoutes() {
  const { firebaseUser, seenUser, initialized, isLoading } = useAuth();
  usePushNotifications();

  if (!initialized) return <SplashScreen />;

  const isAuthenticated = !!firebaseUser;
  const isOnboarded = !!seenUser?.onboardingCompleted;

  console.log('[Router]', { isAuthenticated, isOnboarded, seenUser: seenUser ? { uid: seenUser.uid, onboardingCompleted: seenUser.onboardingCompleted } : null });

  // Not authenticated → auth flow
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/delete-account" element={<DeleteAccount />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/auth" element={<AuthOptionsScreen />} />
        <Route path="/auth/email" element={<EmailInputScreen />} />
        <Route path="/auth/verify" element={<EmailLinkWaitingScreen />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  // Authenticated but profile still loading (e.g. after onboarding save)
  if (isAuthenticated && !seenUser && isLoading) {
    return <SplashScreen />;
  }

  // Authenticated but not onboarded → onboarding
  if (!isOnboarded) {
    return (
      <Routes>
        <Route path="/delete-account" element={<DeleteAccount />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  // Fully authenticated and onboarded → main app
  console.log('[Router] Rendering main app. Routing to: /');
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Reflect />} />
        <Route path="/resonate" element={<Resonate />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/me" element={<Me />} />
      </Route>
      <Route path="/me/profile" element={<BasicProfile />} />
      <Route path="/me/understanding" element={<Understanding />} />
      <Route path="/me/ai-response" element={<AIResponse />} />
      <Route path="/me/privacy" element={<PrivacyData />} />
      <Route path="/me/account" element={<AccountLanguage />} />
      <Route path="/me/questions" element={<MyQuestions />} />
      <Route path="/me/about-you" element={<AboutMeOptional />} />
      <Route path="/delete-account" element={<DeleteAccount />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
