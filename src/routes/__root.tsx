import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  redirect,
  isRedirect,
  useLocation,
  useNavigate
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { getSessionUserFn } from "../lib/auth/server";
import { candidateSignature } from "../lib/personalization";
import { candidateProfile } from "../data/candidate-profile";
import { OnboardingProvider, useOnboarding } from "../components/onboarding/OnboardingProvider";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="label-mono text-ink-muted">RADAR · 404</p>
        <h1 className="mt-3 font-serif text-5xl text-ink">Signal lost</h1>
        <p className="mt-3 text-sm text-ink-muted">
          This opportunity is not on the shortlist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center rounded-sm border border-ink bg-ink px-4 py-2 label-mono text-parchment transition-colors hover:bg-parchment hover:text-ink"
          >
            Return to shortlist
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[Root Error Boundary]", error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="max-w-xl text-center">
        <p className="label-mono text-ink-muted">RADAR · System Error</p>
        <h1 className="mt-3 font-serif text-3xl text-ink">Recommendation unavailable</h1>
        <p className="mt-3 text-sm text-ink-muted">
          The advisory couldn't render this brief.
        </p>
        {error && (
          <div className="mt-4 p-4 rounded bg-red-950/10 border border-red-500/20 text-left overflow-auto max-h-60 text-xs font-mono text-red-600">
            <p className="font-bold">{error.name || "Error"}: {error.message || String(error)}</p>
            {error.stack && <pre className="mt-2 text-[0.65rem] whitespace-pre-wrap">{error.stack}</pre>}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center rounded-sm border border-ink bg-ink px-4 py-2 label-mono text-parchment"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center rounded-sm border border-ink/20 px-4 py-2 label-mono text-ink"
          >
            Shortlist
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location }) => {
    const isPublicRoute =
      location.pathname === "/login" ||
      location.pathname.startsWith("/api/auth") ||
      location.pathname.startsWith("/assets") ||
      /\.(css|js|gif|png|jpg|jpeg|ico|svg|woff|woff2|ttf|eot)$/i.test(location.pathname);
    if (isPublicRoute) return;

    try {
      const user = await getSessionUserFn();
      if (!user) {
        if (typeof window !== "undefined") {
          if (!sessionStorage.getItem("radar_session")) {
            throw redirect({ to: '/login' });
          }
        } else {
          throw redirect({ to: '/login' });
        }
      }
    } catch (e: any) {
      if (isRedirect(e)) throw e;
      if (typeof window !== "undefined") {
        if (!sessionStorage.getItem("radar_session")) {
          throw redirect({ to: '/login' });
        }
      } else {
        throw redirect({ to: '/login' });
      }
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "RADAR — Executive Opportunity Intelligence" },
      { name: "description", content: "Evidence-anchored recommendations on where an experienced executive should invest their limited career headspace." },
      { name: "author", content: "RADAR" },
      { property: "og:title", content: "RADAR — Executive Opportunity Intelligence" },
      { property: "og:description", content: "A private advisory that recommends which opportunities deserve serious pursuit — and proves it from your career." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;1,400&family=Inter+Tight:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.gif", type: "image/gif" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <HeadContent />
      </head>
      <body className="max-w-full">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function GlobalHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resetOnboarding } = useOnboarding();
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsDev(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      setIsDark(document.documentElement.classList.contains("dark"));
      const sessionStr = sessionStorage.getItem("radar_session");
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          setSessionName(session.name);
        } catch {}
      }
    }
  }, []);

  const toggleTheme = () => {
    if (typeof window !== "undefined") {
      const root = document.documentElement;
      if (root.classList.contains("dark")) {
        root.classList.remove("dark");
        setIsDark(false);
      } else {
        root.classList.add("dark");
        setIsDark(true);
      }
    }
  };

  const name = sessionName || candidateProfile.identity.name;
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "SS";

  const isSelected = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 glass-header w-full shadow-xs">
      <div className="memo-container grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 py-2.5">
        {/* Brand & Telemetry */}
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="font-mono text-[0.82rem] font-bold tracking-[0.38em] text-foreground group-hover:text-primary transition-colors">RADAR</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.62rem] font-mono text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            1,285 LIVE
          </span>
        </div>

        {/* Navigation Bar */}
        <nav className="flex items-center justify-end gap-1.5 overflow-x-auto">
          <ul className="flex items-center gap-1 bg-muted/50 p-1 rounded-full border border-border/40">
            <li>
              <Link
                to="/"
                className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                  isSelected("/") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Shortlist
              </Link>
            </li>
            <li>
              <Link
                to="/profile"
                className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                  isSelected("/profile") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Profile
              </Link>
            </li>
            <li>
              <Link
                to="/decisions"
                className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                  isSelected("/decisions") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Opportunities
              </Link>
            </li>
            <li>
              <Link
                to="/corpus"
                className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                  isSelected("/corpus") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Corpus
              </Link>
            </li>
            {isDev && (
              <>
                <li>
                  <Link
                    to="/design-system"
                    className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                      isSelected("/design-system") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Design System
                  </Link>
                </li>
                <li>
                  <Link
                    to="/font-sandbox"
                    className={`label-mono block whitespace-nowrap rounded-full px-3 py-1 transition-all ${
                      isSelected("/font-sandbox") ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Font Lab
                  </Link>
                </li>
              </>
            )}
          </ul>

          {/* Theme Switcher Toggle */}
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="ml-1 p-1.5 rounded-full border border-border/60 bg-background text-foreground hover:bg-muted transition-colors text-xs"
          >
            {isDark ? "☀️" : "🌙"}
          </button>

          <span className="ml-1 hidden shrink-0 items-center gap-2 border-l border-border/60 pl-3 sm:flex">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary font-mono text-[0.55rem] text-primary-foreground font-bold shadow-xs">
              {initials}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[120px] block">{name}</span>
          </span>

          <a
            href="/api/auth/logout"
            id="sign-out-link"
            className="label-mono ml-1 block whitespace-nowrap px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            Exit
          </a>
        </nav>
      </div>
    </header>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();

  const showHeader = !location.pathname.startsWith("/login") &&
    !location.pathname.startsWith("/api/auth") &&
    !location.pathname.startsWith("/welcome");

  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingProvider>
        {showHeader && <GlobalHeader />}
        <Outlet />
      </OnboardingProvider>
    </QueryClientProvider>
  );
}
