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

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-muted">RADAR · 404</p>
        <h1 className="mt-3 font-serif text-5xl text-ink">Signal lost</h1>
        <p className="mt-3 text-sm text-ink-muted">
          This opportunity is not on the shortlist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center rounded-sm border border-ink bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-parchment transition-colors hover:bg-parchment hover:text-ink"
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
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-muted">RADAR · System Error</p>
        <h1 className="mt-3 font-serif text-3xl text-ink">Recommendation unavailable</h1>
        <p className="mt-3 text-sm text-ink-muted">
          The advisory couldn't render this brief.
        </p>
        {error && (
          <div className="mt-4 p-4 rounded bg-red-950/10 border border-red-500/20 text-left overflow-auto max-h-60 text-xs font-mono text-red-600">
            <p className="font-bold">{error.name || "Error"}: {error.message || String(error)}</p>
            {error.stack && <pre className="mt-2 text-[10px] whitespace-pre-wrap">{error.stack}</pre>}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center rounded-sm border border-ink bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-parchment"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center rounded-sm border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink"
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
    <html lang="en" className="overflow-x-hidden">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <HeadContent />
      </head>
      <body className="overflow-x-hidden max-w-full">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function GlobalHeader() {
  const location = useLocation();
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sessionStr = sessionStorage.getItem("radar_session");
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          setSessionName(session.name);
        } catch {}
      }
    }
  }, []);

  const signature = sessionName || candidateSignature();

  const isSelected = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  let pageName = "Advisory";
  if (location.pathname === "/profile") pageName = "Profile";
  else if (location.pathname === "/decisions") pageName = "Decisions";
  else if (location.pathname === "/corpus") pageName = "Corpus";
  else if (location.pathname.startsWith("/opportunity/")) pageName = "Brief";

  return (
    <header className="border-b border-hairline bg-parchment/95 sticky top-0 z-50 backdrop-blur-md w-full">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-3 sm:px-6 py-2.5">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/" className="font-mono text-[12px] sm:text-[13px] font-bold uppercase tracking-[0.2em] text-ink hover:opacity-80 transition-opacity">
            RADAR
          </Link>
          <span className="text-ink-muted text-[11px] hidden xs:inline">·</span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-muted font-medium hidden xs:inline">
            {pageName}
          </span>
        </div>

        {/* Navigation Bar */}
        <nav className="flex items-center gap-2 xs:gap-3.5 sm:gap-6 text-[10px] sm:text-[11.5px] font-mono shrink-0">
          <Link
            to="/"
            className={
              isSelected("/")
                ? "font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink border-b-2 border-ink pb-0.5"
                : "font-medium uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink-muted hover:text-ink transition-colors"
            }
          >
            Shortlist
          </Link>
          <Link
            to="/profile"
            className={
              isSelected("/profile")
                ? "font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink border-b-2 border-ink pb-0.5"
                : "font-medium uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink-muted hover:text-ink transition-colors"
            }
          >
            Profile
          </Link>
          <Link
            to="/decisions"
            className={
              isSelected("/decisions")
                ? "font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink border-b-2 border-ink pb-0.5"
                : "font-medium uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink-muted hover:text-ink transition-colors"
            }
          >
            Decisions
          </Link>
          <Link
            to="/corpus"
            className={
              isSelected("/corpus")
                ? "font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink border-b-2 border-ink pb-0.5"
                : "font-medium uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink-muted hover:text-ink transition-colors hidden sm:inline"
            }
          >
            Corpus
          </Link>
          <a
            href="/api/auth/logout"
            id="sign-out-link"
            className="font-medium uppercase tracking-[0.08em] sm:tracking-[0.12em] text-ink-muted hover:text-ink transition-colors pl-1"
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
    !location.pathname.startsWith("/api/auth");

  return (
    <QueryClientProvider client={queryClient}>
      {showHeader && <GlobalHeader />}
      <Outlet />
    </QueryClientProvider>
  );
}
