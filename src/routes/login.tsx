import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { initializeSessionFn } from "../lib/intelligence/profile-server";

export const Route = createFileRoute("/login")({
  component: LoginComponent,
});

function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState("swapnil");

  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    // If already logged in, redirect to home
    const session = sessionStorage.getItem("radar_session");
    if (session) {
      navigate({ to: "/" });
    }
    if (typeof window !== "undefined" && window.location.search.includes("missing_google_credentials")) {
      setShowWarning(true);
    }
  }, [navigate]);

  const handleMagicLogin = async () => {
    setLoading(true);
    try {
      // Trigger server-side session state initialization
      const initResult = await initializeSessionFn({
        data: { mode: selectedUser === "swapnil" ? "swapnil" : "new_user" }
      });
      
      if (!initResult.success) {
        throw new Error("Server failed to initialize the selected profile session.");
      }

      let sessionData = {
        userId: selectedUser === "swapnil" ? "swapnil-shukla-dev" : `user-${Date.now()}`,
        email: selectedUser === "swapnil" ? "swapnil@radar.advisory" : "guest@radar.advisory",
        name: selectedUser === "swapnil" ? "Swapnil Shukla" : "Guest Executive",
        avatarUrl: "https://lh3.googleusercontent.com/a/default-user=s100",
        onboarded: selectedUser === "swapnil"
      };

      sessionStorage.setItem("radar_session", JSON.stringify(sessionData));
      
      // Redirect to onboard/profile if new, or home if existing
      if (selectedUser === "new_user") {
        navigate({ to: "/profile" });
      } else {
        navigate({ to: "/" });
      }
    } catch (err: any) {
      console.error("Failed to initialize session:", err);
      alert(`Initialization failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-parchment text-ink font-sans antialiased">
      {/* Container */}
      <div className="relative w-full max-w-[420px] px-6">
        <div className="rounded-md border border-hairline bg-card p-10 shadow-[0_12px_40px_rgba(0,0,0,0.03)]">
          
          {/* Logo */}
          <div className="mb-10 text-center">
            <span className="font-mono text-xs uppercase tracking-[0.4em] text-ink font-semibold">RADAR</span>
            <div className="h-[1px] w-8 bg-ink/10 mx-auto mt-2.5 mb-5" />
            <p className="font-serif text-lg text-ink font-medium tracking-tight">Executive Opportunity Intelligence</p>
            <p className="text-[13px] text-ink-muted mt-2 font-light max-w-xs mx-auto leading-relaxed">
              Evidence-anchored career advisory for senior commercial growth executives.
            </p>
          </div>

          {/* Error Banner */}
          {showWarning && (
            <div className="mb-6 border border-amber-500/30 bg-amber-500/5 p-3 rounded-md text-[12px] text-amber-900 leading-relaxed font-normal">
              Google OAuth client keys are not set in your <code>.env</code> file. Use <strong>Direct Executive Access</strong> below to log in immediately.
            </div>
          )}

          {/* Login Options */}
          <div className="space-y-3">
            {/* Real Google OAuth button */}
            <a
              href="/api/auth/google"
              id="google-oauth-btn"
              className="flex w-full items-center justify-center gap-3 rounded-md border border-hairline bg-parchment py-3 px-4 text-[13px] font-medium tracking-wide text-ink transition-all hover:bg-muted active:scale-[0.98] cursor-pointer no-underline"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" width="24" height="24">
                <g transform="matrix(1, 0, 0, 1, 0, 0)">
                  <path fill="#EA4335" d="M20.6,10.2c1-1,1.5-2.4,1.4-3.8H12v4.8h5.7c-0.2,1.3-1,2.4-2.1,3.1v3.1h4.1C22,15.1,23.3,12.4,20.6,10.2z" />
                  <path fill="#4285F4" d="M12,23c3.2,0,6-1.1,8-2.9l-4.1-3.1c-1.1,0.8-2.5,1.2-3.9,1.2c-3,0-5.6-2-6.5-4.8H1.3v3.2C3.3,20.2,7.4,23,12,23z" />
                  <path fill="#34A853" d="M5.5,13.4C5,11.8,5,10.2,5.5,8.6V5.4H1.3C-0.4,8.2-0.4,13.8,1.3,16.6L5.5,13.4z" />
                  <path fill="#FBBC05" d="M12,5c1.7,0,3.3,0.6,4.6,1.8l3.4-3.4C17.9,1.5,15,0.7,12,0.7C7.4,0.7,3.3,3.5,1.3,7.2l4.1,3.2C6.4,7.6,9,5,12,5z" />
                </g>
              </svg>
              Continue with Google
            </a>

            {/* Direct Executive Access Button */}
            <button
              onClick={handleMagicLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-hairline bg-card py-3 px-4 text-[13px] font-semibold tracking-wide text-ink transition-all hover:bg-muted active:scale-[0.98] cursor-pointer"
            >
              {loading ? "Accessing Advisory Radar..." : "Direct Executive Access (Swapnil Shukla)"}
            </button>
          </div>

          {/* Policy disclaimer */}
          <div className="mt-8 text-center text-[11px] text-ink-muted leading-relaxed font-light">
            Advisory access subject to invite credentials. By continuing you agree to RADAR's cognitive bandwidth and executive search guidelines.
          </div>

        </div>
      </div>
    </div>
  );
}

function LoginComponent() {
  return <Login />;
}
