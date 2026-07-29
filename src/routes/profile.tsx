import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  uploadDocumentFn,
  getPipelineStatusFn,
  saveIntentFn,
  getLatestIntentFn
} from "../lib/intelligence/document-server";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Executive Intent — RADAR" },
      { name: "description", content: "Upload executive resume and configure career intent." }
    ]
  }),
  loader: async () => {
    const intent = await getLatestIntentFn();
    return { intent };
  },
  component: ProfilePage
});

function ProfilePage() {
  const { intent } = Route.useLoaderData();
  const router = useRouter();

  // Intent form state
  const [currency, setCurrency] = useState<"INR" | "USD" | "EUR" | "GBP">(
    (intent as any)?.currency || "INR"
  );
  const [targetSalary, setTargetSalary] = useState<number>(
    (intent as any)?.targetSalaryAmount || (intent as any)?.minSalaryUsd || 8000000
  );
  const [locations, setLocations] = useState((intent?.preferredLocations || ["Gurugram", "Remote India"]).join(", "));
  const [targetTitles, setTargetTitles] = useState((intent?.targetTitles || ["Vice President", "CMO", "CGO"]).join(", "));
  const [workModel, setWorkModel] = useState<"HYBRID" | "REMOTE" | "ON_SITE" | "ANY">(intent?.preferredWorkModel || "ANY");
  const [isSavingIntent, setIsSavingIntent] = useState(false);
  const [intentSavedMsg, setIntentSavedMsg] = useState("");

  // Upload & Pipeline state
  const [pasteText, setPasteText] = useState("");
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [pipelineStage, setPipelineStage] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Poll pipeline stage status when a document upload is in progress
  useEffect(() => {
    if (!activeDocId || pipelineStatus === "COMPLETED" || pipelineStatus === "FAILED") return;

    const interval = setInterval(async () => {
      try {
        const res = await getPipelineStatusFn({ data: { documentId: activeDocId } });
        if (res.success && res.stage) {
          setPipelineStage(res.stage);
          setPipelineStatus(res.status || "PROCESSING");

          if (res.status === "COMPLETED") {
            // Trigger automatic router revalidation to refresh dashboard feeds
            await router.invalidate();
          } else if (res.status === "FAILED") {
            setUploadError(res.errorMessage || "Pipeline processing failed.");
          }
        }
      } catch (err: any) {
        console.error("Status check error:", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeDocId, pipelineStatus, router]);

  const handleTextUpload = async () => {
    if (!pasteText.trim()) return;
    setIsUploading(true);
    setUploadError(null);
    setPipelineStage("DOCUMENT_REGISTERED");
    setPipelineStatus("PROCESSING");

    try {
      const res = await uploadDocumentFn({
        data: {
          filename: "pasted_resume_text.txt",
          mimeType: "text/plain",
          documentText: pasteText
        }
      });

      if (res.success && res.documentId) {
        setActiveDocId(res.documentId);
      } else {
        setUploadError("Failed to initiate upload.");
        setIsUploading(false);
      }
    } catch (err: any) {
      setUploadError(err.message || "Upload error");
      setIsUploading(false);
    }
  };

  const handleSaveIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingIntent(true);
    setIntentSavedMsg("");

    try {
      const locList = locations.split(",").map(s => s.trim()).filter(Boolean);
      const titleList = targetTitles.split(",").map(s => s.trim()).filter(Boolean);

      await saveIntentFn({
        data: {
          currency,
          targetSalaryAmount: Number(targetSalary),
          minSalaryUsd: currency === "USD" ? Number(targetSalary) : Math.round(Number(targetSalary) / 83),
          preferredLocations: locList,
          targetTitles: titleList,
          preferredWorkModel: workModel
        }
      });

      setIntentSavedMsg("Career intent saved (new version created)!");
      await router.invalidate();
    } catch (err: any) {
      console.error("Save intent failed:", err);
    } finally {
      setIsSavingIntent(false);
    }
  };

  const stages = [
    { id: "DOCUMENT_REGISTERED", label: "Document Registered" },
    { id: "TEXT_EXTRACTED", label: "Text & Hash Deduplication" },
    { id: "EVIDENCE_EXTRACTED", label: "Evidence Graph Extracted" },
    { id: "NORMALIZED", label: "Acronyms & Values Normalized" },
    { id: "ONTOLOGY_RESOLVED", label: "Mapped to V4 Ontology" },
    { id: "PROJECTION_BUILT", label: "Candidate Projection Assembled" },
    { id: "INFERENCE_COMPLETE", label: "Altitude & Level Inferred" },
    { id: "EVALUATED", label: "Dashboard Recommendations Refreshed" },
    { id: "COMPLETED", label: "Complete" }
  ];

  const getStageIndex = (stageId: string | null) => {
    if (!stageId) return -1;
    return stages.findIndex(s => s.id === stageId);
  };

  const currentStageIdx = getStageIndex(pipelineStage);

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8 space-y-10 text-foreground">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Executive Profile & Intent</h1>
        <p className="text-muted-foreground mt-1">
          Upload your resume to extract immutable evidence, and explicitly configure your strategic career intent.
        </p>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Document Upload Zone */}
        <div className="p-6 rounded-xl border bg-card shadow-sm space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            📄 Resume & Evidence Extraction
          </h2>
          <p className="text-xs text-muted-foreground">
            ADR-011: Document evidence is extracted into an immutable graph. Deduplication skips redundant LLM calls automatically.
          </p>

          <div className="space-y-3">
            <label className="text-sm font-medium">Paste CV / Resume Text</label>
            <textarea
              className="w-full h-40 p-3 text-xs font-mono rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Paste Executive CV / Resume text here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              onClick={handleTextUpload}
              disabled={isUploading || !pasteText.trim()}
              className="w-full py-2.5 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isUploading ? "Uploading & Processing..." : "Process Executive Resume ➔"}
            </button>
          </div>

          {uploadError && (
            <div className="p-3 text-xs rounded border border-red-500/50 bg-red-500/10 text-red-500">
              {uploadError}
            </div>
          )}

          {/* Pipeline Stage Stepper */}
          {activeDocId && (
            <div className="mt-6 pt-4 border-t space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Live Resumable Pipeline Execution
              </h3>
              <div className="space-y-1.5">
                {stages.map((st, idx) => {
                  const isDone = currentStageIdx > idx || pipelineStatus === "COMPLETED";
                  const isCurrent = currentStageIdx === idx && pipelineStatus !== "COMPLETED";
                  return (
                    <div
                      key={st.id}
                      className={`flex items-center gap-2 text-xs p-1.5 rounded transition-colors ${
                        isDone
                          ? "text-emerald-500 font-medium"
                          : isCurrent
                          ? "text-primary font-bold bg-primary/10 animate-pulse"
                          : "text-muted-foreground/50"
                      }`}
                    >
                      <span>{isDone ? "✓" : isCurrent ? "⏳" : "○"}</span>
                      <span>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Career Intent Panel (ADR-012) */}
        <form onSubmit={handleSaveIntent} className="p-6 rounded-xl border bg-card shadow-sm space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            🎯 Strategic Career Intent
          </h2>
          <p className="text-xs text-muted-foreground">
            ADR-012: Intent is explicit and human-configured. It is never assumed or inferred from past CV evidence.
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Currency</label>
                <select
                  className="w-full p-2 text-sm rounded border bg-background"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as any)}
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium block mb-1">
                  Target Minimum Salary ({currency === "INR" ? "₹ INR" : currency === "EUR" ? "€ EUR" : currency === "GBP" ? "£ GBP" : "$ USD"})
                </label>
                <input
                  type="number"
                  className="w-full p-2 text-sm rounded border bg-background"
                  placeholder={currency === "INR" ? "8000000 (80 Lakhs)" : "150000"}
                  value={targetSalary}
                  onChange={(e) => setTargetSalary(Number(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Preferred Target Locations (comma separated)</label>
              <input
                type="text"
                className="w-full p-2 text-sm rounded border bg-background"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Target Executive Titles (comma separated)</label>
              <input
                type="text"
                className="w-full p-2 text-sm rounded border bg-background"
                value={targetTitles}
                onChange={(e) => setTargetTitles(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Preferred Work Model</label>
              <select
                className="w-full p-2 text-sm rounded border bg-background"
                value={workModel}
                onChange={(e) => setWorkModel(e.target.value as any)}
              >
                <option value="ANY">ANY (Flexible / All Models)</option>
                <option value="HYBRID">HYBRID</option>
                <option value="REMOTE">REMOTE</option>
                <option value="ON_SITE">ON_SITE</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSavingIntent}
              className="w-full py-2.5 px-4 rounded-md bg-secondary text-secondary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSavingIntent ? "Saving Intent Version..." : "Save Career Intent Version ➔"}
            </button>

            {intentSavedMsg && (
              <p className="text-xs text-emerald-500 font-medium text-center">{intentSavedMsg}</p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
