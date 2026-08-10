import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { 
  type OnboardingProgress, 
  DEFAULT_PROGRESS,
  saveOnboardingProgressFn
} from '@/lib/intelligence/onboarding-server';

interface OnboardingContextValue {
  progress: OnboardingProgress;
  isOnboarding: boolean;
  needsSetup: boolean;
  markOrientationSeen: () => void;
  markEvidenceProvided: () => void;
  markEvidenceSkipped: () => void;
  markIntentSet: () => void;
  markIntentSkipped: () => void;
  markArrivalSeen: () => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}

interface OnboardingProviderProps {
  initialProgress?: OnboardingProgress;
  children: ReactNode;
}

export function OnboardingProvider({ initialProgress, children }: OnboardingProviderProps) {
  const [progress, setProgress] = useState<OnboardingProgress>(() => {
    if (initialProgress) return initialProgress;
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('radar_onboarding');
      if (stored) {
        try {
          return JSON.parse(stored) as OnboardingProgress;
        } catch (e) {
          // ignore parse error
        }
      }
    }
    return DEFAULT_PROGRESS;
  });

  const updateProgress = useCallback((updates: Partial<OnboardingProgress>) => {
    setProgress((prev) => {
      const next = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('radar_onboarding', JSON.stringify(next));
      }
      
      // Fire-and-forget to server
      saveOnboardingProgressFn({ data: { progress: updates } }).catch(err => {
        console.error('Failed to save onboarding progress to server', err);
      });
      
      return next;
    });
  }, []);

  const markOrientationSeen = useCallback(() => updateProgress({ orientationSeen: true }), [updateProgress]);
  const markEvidenceProvided = useCallback(() => updateProgress({ evidenceStatus: 'provided' }), [updateProgress]);
  const markEvidenceSkipped = useCallback(() => updateProgress({ evidenceStatus: 'skipped' }), [updateProgress]);
  const markIntentSet = useCallback(() => updateProgress({ intentStatus: 'set' }), [updateProgress]);
  const markIntentSkipped = useCallback(() => updateProgress({ intentStatus: 'skipped' }), [updateProgress]);
  const markArrivalSeen = useCallback(() => updateProgress({ arrivalSeen: true }), [updateProgress]);

  const resetOnboarding = useCallback(() => {
    const resetState = { ...DEFAULT_PROGRESS };
    setProgress(resetState);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('radar_onboarding', JSON.stringify(resetState));
    }
    saveOnboardingProgressFn({ data: { progress: resetState } }).catch(err => {
      console.error('Failed to reset onboarding progress on server', err);
    });
  }, []);

  const isOnboarding = !progress.arrivalSeen;
  const needsSetup = progress.evidenceStatus === 'pending' || progress.intentStatus === 'pending';

  const value: OnboardingContextValue = {
    progress,
    isOnboarding,
    needsSetup,
    markOrientationSeen,
    markEvidenceProvided,
    markEvidenceSkipped,
    markIntentSet,
    markIntentSkipped,
    markArrivalSeen,
    resetOnboarding,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
