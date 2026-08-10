import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
  head: () => ({
    meta: [
      { title: 'Welcome — RADAR' },
      { name: 'description', content: 'Set up your executive advisory profile.' }
    ]
  }),
});

function WelcomePage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    const sessionStr = sessionStorage.getItem('radar_session');
    if (!sessionStr) {
      navigate({ to: '/login' });
      return;
    }
    
    const onboardingStr = sessionStorage.getItem('radar_onboarding');
    if (onboardingStr) {
      try {
        const onboarding = JSON.parse(onboardingStr);
        if (onboarding.orientationSeen === true) {
          navigate({ to: '/profile' });
        }
      } catch (e) {
        // Ignore parse error
      }
    }
  }, [navigate]);

  const handleContinue = () => {
    sessionStorage.setItem('radar_onboarding', JSON.stringify({
      orientationSeen: true,
      evidenceStatus: 'pending',
      intentStatus: 'pending',
      arrivalSeen: false
    }));
    navigate({ to: '/profile' });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-parchment text-ink font-sans antialiased overflow-hidden">
      <div className={`w-full max-w-[480px] px-6 text-center animate-reveal transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-ink font-semibold mb-6">RADAR</div>
        
        <div className="h-[1px] w-8 bg-hairline mx-auto mb-8" />
        
        <h1 className="font-serif text-3xl md:text-4xl text-ink font-normal leading-tight mb-6">
          Let's find the opportunities<br />worth your time.
        </h1>
        
        <p className="font-sans text-sm md:text-base text-muted-foreground leading-relaxed mb-12">
          Give RADAR your career evidence and tell us where you want to go. We’ll evaluate opportunities against both — and surface the ones worth pursuing.
        </p>
        
        <div className="flex flex-col items-center gap-4">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            About 2 minutes to get started.
          </div>
          
          <button 
            onClick={handleContinue}
            className="rounded-sm border border-hairline bg-transparent px-6 py-2.5 font-mono text-xs uppercase tracking-wider text-ink transition-colors hover:bg-muted active:scale-[0.98] cursor-pointer"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
