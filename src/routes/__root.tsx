import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

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
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-muted">RADAR · System</p>
        <h1 className="mt-3 font-serif text-3xl text-ink">Recommendation unavailable</h1>
        <p className="mt-3 text-sm text-ink-muted">
          The advisory couldn't render this brief. Refresh, or return to the shortlist.
        </p>
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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
