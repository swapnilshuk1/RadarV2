import { IntelligenceTaxonomyControls } from "../admin/IntelligenceTaxonomyControls";
import { OperationsControls } from "../admin/OperationsControls";
import { getOperationsFn } from "../admin/operations-server";
import { getConfigSnapshotFn } from "../admin/config-server";
import { ConfigControls } from "../admin/ConfigControls";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getAdminSnapshotFn } from "../admin/server";
import { engineStages } from "../admin/stages";
import { quotaDimensions, type QuotaDimension } from "../admin/protection-contracts";
import { ProtectionControls } from "../admin/ProtectionControls";
import { TaxonomyControls } from "../admin/TaxonomyControls";
import { getTaxonomySnapshotFn } from "../admin/taxonomy-server";
import type { AdminSection } from "../admin/service";

const views = [
  "Overview",
  "Connections",
  "Engine",
  "Models",
  "Taxonomy",
  "Tenants & Quotas",
  "Operations",
  "Audit",
] as const;
export const Route = createFileRoute("/admin")({
  validateSearch: (s: Record<string, unknown>) => ({
    view:
      typeof s.view === "string" && views.includes(s.view as (typeof views)[number])
        ? s.view
        : "Overview",
    tenantId: typeof s.tenantId === "string" ? s.tenantId : undefined,
    days: [1, 7, 30].includes(Number(s.days)) ? Number(s.days) : 7,
  }),
  loaderDeps: ({ search }) => ({ tenantId: search.tenantId, days: search.days }),
  loader: async ({ deps }) => {
    const [snapshot, configuration, taxonomy, operations] = await Promise.all([
      getAdminSnapshotFn({ data: deps }),
      getConfigSnapshotFn({ data: { tenantId: deps.tenantId } }),
      getTaxonomySnapshotFn(),
      getOperationsFn(),
    ]);
    return { ...snapshot, configuration, taxonomy, operations };
  },
  component: AdminShell,
  errorComponent: () => (
    <main className="mx-auto max-w-3xl p-12">
      <h1 className="font-serif text-3xl">Administration unavailable</h1>
      <p className="mt-4">
        Platform access is required. Tenant administrator membership does not grant console access.
        If you have platform access, check that the administration migration is installed.
      </p>
    </main>
  ),
});

function AdminShell() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const [intelligenceDirty, setIntelligenceDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [comfortable, setComfortable] = useState(false);
  const [detail, setDetail] = useState<{ title: string; body: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openDetail = (title: string, body: string) => {
    triggerRef.current = document.activeElement as HTMLElement;
    setDetail({ title, body });
  };
  const closeDetail = () => {
    setDetail(null);
    triggerRef.current?.focus();
  };
  const navigate = (view: string) =>
    void router.navigate({ to: "/admin", search: { ...search, view } });
  useEffect(() => {
    if (detail) closeRef.current?.focus();
  }, [detail]);
  useEffect(() => {
    let prefix = false;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDetail();
        prefix = false;
        return;
      }
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (prefix) {
        const i = "oemtqpa".indexOf(e.key);
        if (i >= 0) void router.navigate({ to: "/admin", search: { ...search, view: views[i] } });
        prefix = false;
      } else prefix = e.key === "g";
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [search, router]);
  const queueSections = data.sections.filter(
    (s) => !["Usage", "Tenants", "Audit", "Quotas", "Overrides"].includes(s.title),
  );
  const selected =
    search.view === "Audit"
      ? data.sections.filter((s) => s.title === "Audit")
      : search.view === "Tenants & Quotas"
        ? data.sections.filter((s) =>
            ["Tenants", "Quotas", "Overrides", "Reservations"].includes(s.title),
          )
        : search.view === "Operations"
          ? queueSections
          : search.view === "Models"
            ? data.sections.filter((s) => s.title === "Usage")
            : search.view === "Overview"
              ? data.sections.filter(
                  (s) =>
                    ![
                      "Audit",
                      "Quotas",
                      "Overrides",
                      "Controls",
                      "Deferrals",
                      "Reservations",
                    ].includes(s.title),
                )
              : [];
  const stale =
    !data.rollupAt ||
    data.sections.find((s) => s.title === "Usage")?.rows === null ||
    Date.now() - data.rollupAt > 2 * 3600000;
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] pt-28 text-foreground">
      <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] md:grid-cols-[238px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-border bg-card py-7 md:border-b-0 md:border-r">
          <p className="px-6 font-mono text-[.62rem] uppercase tracking-[.28em] text-muted-foreground">
            RADAR / CONTROL
          </p>
          <p className="mt-3 px-6 font-serif text-2xl">Administration</p>
          <nav
            aria-label="Administration"
            className="mt-7 flex overflow-x-auto border-t border-border md:flex-col"
          >
            {views.map((view, index) => (
              <button
                key={view}
                aria-current={search.view === view ? "page" : undefined}
                onClick={() => navigate(view)}
                className={`flex items-center gap-4 whitespace-nowrap border-b border-l-2 border-border px-6 py-3 text-left text-sm ${search.view === view ? "border-l-primary bg-muted text-foreground" : "border-l-transparent text-muted-foreground hover:bg-muted"}`}
              >
                <span className="font-mono text-[.6rem]">{String(index + 1).padStart(2, "0")}</span>
                {view}
              </button>
            ))}
          </nav>
          <p className="mt-7 px-6 text-xs leading-6 text-muted-foreground">
            Engine control console
            <br />
            Platform {data.role}
          </p>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-5 border-b border-border px-6 py-8 lg:px-10">
            <div>
              <p className="mb-3 font-mono text-[.62rem] uppercase tracking-[.2em] text-muted-foreground">
                Platform operations
              </p>
              <h1 className="font-serif text-4xl sm:text-5xl">
                {search.view === "Overview"
                  ? "System overview"
                  : search.view === "Engine"
                    ? "Engine registry"
                    : search.view}
              </h1>
            </div>
            <span className="border border-border px-3 py-2 font-mono text-xs text-muted-foreground">
              {data.role === "operator" ? "Operator" : "Read only"}
            </span>
          </header>
          <p role="status" className="border-b border-border px-5 py-4 text-sm">
            {stale ? "Usage rollup unavailable or stale." : "Usage rollup current."} Queue counts
            reflect persisted state. Active product users: unavailable.
          </p>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 text-sm">
            <label>
              Tenant{" "}
              <select
                aria-label="Tenant"
                value={search.tenantId ?? ""}
                onChange={(e) =>
                  void router.navigate({
                    to: "/admin",
                    search: { ...search, tenantId: e.target.value || undefined },
                  })
                }
                className="border border-border bg-background p-1"
              >
                <option value="">All tenants</option>
                {data.tenants.map((t) => (
                  <option key={t.id}>{t.id}</option>
                ))}
              </select>
            </label>
            <label>
              Window{" "}
              <select
                aria-label="Usage window"
                value={search.days}
                onChange={(e) =>
                  void router.navigate({
                    to: "/admin",
                    search: { ...search, days: Number(e.target.value) },
                  })
                }
                className="border border-border bg-background p-1"
              >
                {[1, 7, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} UTC calendar days
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={searchRef}
              aria-label="Search ledger"
              placeholder="Search ledger /"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 border border-border bg-background px-2 py-1"
            />
            <button
              onClick={() => setComfortable(!comfortable)}
              className="border border-border px-2 py-1"
            >
              {comfortable ? "Compact" : "Comfortable"}
            </button>
            <button
              onClick={() => void router.invalidate()}
              className="border border-border px-2 py-1"
            >
              Refresh
            </button>
          </div>
          <div className="px-6 py-7 lg:px-10">
            {(search.view === "Engine" || search.view === "Models") && (
              <ConfigControls
                key={search.tenantId ?? "platform"}
                data={data.configuration}
                tenantId={search.tenantId}
              />
            )}
            {(search.view === "Overview" || search.view === "Connections") && (
              <OperationsControls data={data.operations} overview={search.view === "Overview"} />
            )}
            {search.view === "Engine" && (
              <>
                <p className="mb-5 text-sm text-muted-foreground">
                  Fixed execution order. REVIEW continues to evidence and evaluation. Pursuit is an
                  optional side lane.
                </p>
                {engineStages
                  .filter((s) => `${s.name} ${s.does}`.toLowerCase().includes(filter.toLowerCase()))
                  .map((s) => (
                    <button
                      key={s.name}
                      onClick={() =>
                        openDetail(
                          s.name,
                          `What enters: ${s.input}\n\nWhat it does: ${s.does}\n\nContinues: ${s.continues}\n\nStops: ${s.stops}`,
                        )
                      }
                      className="flex w-full items-center justify-between border-b border-border py-3 text-left"
                    >
                      <span>
                        <span className="mr-4 font-mono text-muted-foreground">
                          {String(engineStages.indexOf(s) + 1).padStart(2, "0")}
                        </span>
                        <span className="font-serif text-xl">{s.name}</span>
                        <span className="mt-2 block max-w-2xl text-xs leading-6 text-muted-foreground">
                          {s.does}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">{s.kind} →</span>
                    </button>
                  ))}
              </>
            )}
            {search.view === "Taxonomy" && (
              <>
                <IntelligenceTaxonomyControls data={data.taxonomy} onDirty={setIntelligenceDirty} />
                <TaxonomyControls
                  data={data.taxonomy}
                  tenantId={search.tenantId}
                  externalDirty={intelligenceDirty}
                />
              </>
            )}
            {search.view === "Models" && (
              <p className="mb-5 text-sm text-muted-foreground">
                The usage ledger records actual provider calls. Active assignments and fixture bench
                results appear above. Usage alone does not establish connection health.
              </p>
            )}
            {search.view === "Tenants & Quotas" && (
              <p className="mb-5 text-sm text-muted-foreground">
                Membership counts are recorded users, not active product users. Quotas apply at
                claim and before provider dispatch.
              </p>
            )}
            {search.view === "Tenants & Quotas" && (
              <ProtectionControls key={search.tenantId ?? "all"} data={data} mode="quotas" />
            )}
            {search.view === "Operations" && (
              <ProtectionControls key={search.tenantId ?? "all"} data={data} mode="operations" />
            )}
            {selected.map((section) => (
              <Ledger
                key={section.title}
                section={section}
                filter={filter}
                comfortable={comfortable}
                unavailable={section.title === "Usage" && !data.rollupAt}
                open={openDetail}
              />
            ))}
            {selected.length > 0 && (
              <p className="mt-6 font-mono text-xs text-muted-foreground">
                Usage: {data.firstDay} — {data.lastDay} UTC · rollup{" "}
                {data.rollupAt ? new Date(data.rollupAt).toISOString() : "unavailable"}
              </p>
            )}
          </div>
        </div>
      </div>
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={closeDetail}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-drawer-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                closeRef.current?.focus();
              }
            }}
            className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-background p-6"
          >
            <button
              ref={closeRef}
              onClick={closeDetail}
              className="float-right border border-border px-3 py-1"
            >
              Close
            </button>
            <h2 id="admin-drawer-title" className="mb-6 font-serif text-2xl">
              {detail.title}
            </h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{detail.body}</p>
          </section>
        </div>
      )}
    </main>
  );
}

function Ledger({
  section,
  filter,
  comfortable,
  unavailable,
  open,
}: {
  section: AdminSection;
  filter: string;
  comfortable: boolean;
  unavailable: boolean;
  open: (title: string, body: string) => void;
}) {
  const [sort, setSort] = useState<{ column: string; descending: boolean } | null>(null);
  const rows = section.rows?.filter((r) =>
    Object.values(r).some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(filter.toLowerCase()),
    ),
  );
  if (rows && sort)
    rows.sort((a, b) => {
      const left = a[sort.column],
        right = b[sort.column];
      const comparison =
        left === null
          ? right === null
            ? 0
            : 1
          : right === null
            ? -1
            : typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right));
      return sort.descending ? -comparison : comparison;
    });
  const columns = section.rows?.length ? Object.keys(section.rows[0]) : [];
  return (
    <section className="mb-7">
      <div className="mb-4 flex justify-between border-t-2 border-foreground pt-3">
        <h2 className="font-serif text-2xl">{section.title}</h2>
        <button
          className="text-xs underline text-muted-foreground"
          onClick={() => open(`${section.title}: measurement`, section.source)}
        >
          Measurement
        </button>
      </div>
      {unavailable || rows === null || rows === undefined ? (
        <p className="text-sm text-muted-foreground">Unavailable</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">
          No recorded rows{filter ? " match this filter" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    aria-sort={
                      sort?.column === c ? (sort.descending ? "descending" : "ascending") : "none"
                    }
                    className="border-y border-border bg-muted/50 px-2 py-2 text-left font-mono text-[.6rem] font-normal uppercase tracking-wide text-muted-foreground"
                  >
                    <button
                      onClick={() =>
                        setSort({
                          column: c,
                          descending: sort?.column === c ? !sort.descending : false,
                        })
                      }
                    >
                      {c.replaceAll("_", " ")}
                      {sort?.column === c ? (sort.descending ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border">
                  {columns.map((c, j) => (
                    <td
                      key={c}
                      className={`px-2 ${comfortable ? "py-3" : "py-2"} ${typeof r[c] === "number" ? "text-right font-mono tabular-nums" : ""}`}
                    >
                      {j === 0 ? (
                        <button
                          className="underline underline-offset-2"
                          onClick={() => open(section.title, JSON.stringify(r, null, 2))}
                        >
                          {r[c] ?? "unavailable"}
                        </button>
                      ) : r[c] === null ? (
                        section.title === "Quotas" &&
                        quotaDimensions.includes(c as QuotaDimension) ? (
                          "unlimited"
                        ) : (
                          "unavailable"
                        )
                      ) : (
                        String(r[c])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
