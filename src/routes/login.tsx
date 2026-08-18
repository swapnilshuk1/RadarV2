import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/login")({
  component: LoginComponent,
});

function Login() {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [formattedDate, setFormattedDate] = useState("18 AUGUST 2026");

  useEffect(() => {
    // If already logged in, redirect to home
    const session = sessionStorage.getItem("radar_session");
    if (session) {
      navigate({ to: "/" });
    }
    if (typeof window !== "undefined") {
      if (window.location.search.includes("missing_google_credentials")) {
        setShowWarning(true);
      }
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = now.toLocaleString("en-GB", { month: "long" }).toUpperCase();
      const year = now.getFullYear();
      setFormattedDate(`${day} ${month} ${year}`);
    }
  }, [navigate]);

  return (
    <div className="relative min-h-screen bg-background text-foreground font-sans antialiased flex items-center justify-center p-6 sm:p-10 lg:p-16">
      <div className="w-full max-w-[1180px] mx-auto">
        
        {/* TOP MASTHEAD RULE */}
        <header className="border-t-2 border-foreground pt-3 mb-10 sm:mb-14 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-[0.3em] font-semibold text-foreground">
            RADAR
          </span>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground font-normal">
            {formattedDate}
          </span>
        </header>

        {/* MAIN TWO-COLUMN EDITORIAL SPREAD */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          
          {/* LEFT COLUMN: EDITORIAL MANIFESTO & PILLARS */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight text-foreground font-normal">
                Executive opportunity intelligence.
              </h1>
              <p className="font-sans text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl font-normal">
                A standing advisory brief: the shortlist worth your attention, with a written recommendation on each mandate.
              </p>
            </div>

            {/* ROMAN NUMERAL PILLARS */}
            <div className="pt-6">
              <div className="border-t border-border py-4 flex items-baseline gap-6">
                <span className="font-serif text-base text-muted-foreground font-normal w-6 shrink-0">
                  I
                </span>
                <span className="font-serif text-lg sm:text-xl text-foreground font-normal">
                  Evaluated, not indexed
                </span>
              </div>

              <div className="border-t border-border py-4 flex items-baseline gap-6">
                <span className="font-serif text-base text-muted-foreground font-normal w-6 shrink-0">
                  II
                </span>
                <span className="font-serif text-lg sm:text-xl text-foreground font-normal">
                  A recommendation, not a score
                </span>
              </div>

              <div className="border-t border-b border-border py-4 flex items-baseline gap-6">
                <span className="font-serif text-base text-muted-foreground font-normal w-6 shrink-0">
                  III
                </span>
                <span className="font-serif text-lg sm:text-xl text-foreground font-normal">
                  Evidence you can check
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: ADVISORY ACCESS FOLIO CARD */}
          <div className="lg:col-span-5 w-full max-w-md lg:max-w-none mx-auto">
            <div className="rounded-md border border-border bg-card p-6 sm:p-8 shadow-[0_12px_40px_rgba(0,0,0,0.03)] space-y-6">
              
              {/* Card Header */}
              <div className="border-b border-border pb-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
                  Advisory Access
                </span>
              </div>

              {/* Card Headline */}
              <div className="space-y-1 pt-1">
                <h2 className="font-serif text-2xl sm:text-3xl text-foreground font-normal tracking-tight">
                  Sign in to today’s briefing
                </h2>
                <p className="font-sans text-xs sm:text-sm text-muted-foreground font-normal">
                  Access is issued by invitation.
                </p>
              </div>

              {/* Warning Banner */}
              {showWarning && (
                <div className="border border-amber-500/30 bg-amber-500/5 p-3 rounded-md text-xs text-amber-900 leading-relaxed font-normal">
                  Google OAuth client keys are not configured in your environment. Please check your <code>.env</code> settings.
                </div>
              )}

              {/* Google OAuth Action Button */}
              <div className="pt-2">
                <a
                  href="/api/auth/google"
                  id="google-oauth-btn"
                  className="flex w-full items-center justify-center gap-3 rounded-md bg-primary py-3.5 px-4 text-xs font-mono uppercase tracking-wider font-semibold text-primary-foreground transition-all hover:bg-foreground/90 active:scale-[0.98] cursor-pointer no-underline shadow-sm"
                >
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </a>
              </div>

              {/* Edition Metadata Strip */}
              <div className="border-y border-border py-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-muted-foreground uppercase tracking-wider">
                  Edition
                </span>
                <span className="text-foreground font-medium uppercase tracking-wider">
                  Weekly · Confidential
                </span>
              </div>

              {/* Card Footer */}
              <div className="text-center text-xs text-muted-foreground font-sans font-light">
                Prepared for the named recipient only.
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

function LoginComponent() {
  return <Login />;
}
