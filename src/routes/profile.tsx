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
      { name: "description", content: "Upload executive resume (PDF, DOCX, TXT) and configure career intent." }
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
            await router.invalidate();
          } else if (res.status === "FAILED") {
            setUploadError(res.errorMessage || "Pipeline processing failed.");
          }
        }
      } catch (err: any) {
        console.error("Status check error:", err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeDocId, pipelineStatus, router]);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setPipelineStage("DOCUMENT_REGISTERED");
    setPipelineStatus("PROCESSING");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64Buffer = Buffer.from(arrayBuffer).toString("base64");

      const res = await uploadDocumentFn({
        data: {
          filename: file.name,
          mimeType: file.type || "application/pdf",
          base64Buffer
        }
      });

      if (res.success && res.documentId) {
        setActiveDocId(res.documentId);
      } else {
        setUploadError("Failed to initiate file upload.");
        setIsUploading(false);
      }
    } catch (err: any) {
      setUploadError(err.message || "File upload error");
      setIsUploading(false);
    }
  };

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
        setUploadError("Failed to initiate text upload.");
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
    { id: "TEXT_EXTRACTED", label: "Text Extraction & SHA-256 Hash" },
    { id: "EVIDENCE_EXTRACTED", label: "Immutable Evidence Graph Built" },
    { id: "NORMALIZED", label: "Concepts Normalized" },
    { id: "ONTOLOGY_RESOLVED", label: "Hierarchical Concept Resolution (v14.2.1)" },
    { id: "PROJECTION_BUILT", label: "Candidate Projection Assembled" },
    { id: "INFERENCE_COMPLETE", label: "Executive Level & Scope Inferred" },
    { id: "EVALUATED", label: "Executive Briefs & Similarity Scores Refreshed" },
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
          Upload your resume (PDF, Word DOCX, Plain Text) to extract immutable evidence, and explicitly configure your strategic career intent.
        </p>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Document Upload Zone */}
        <div className="p-6 rounded-xl border bg-card shadow-sm space-y-5">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            📄 Resume & Evidence Ingestion
          </h2>

          {/* Native File Upload Dropzone */}
          <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3 bg-muted/20 hover:border-primary transition-colors">
            <div className="text-3xl">📥</div>
            <div className="text-xs font-medium text-foreground">
              Upload PDF or Word Document (`.pdf`, `.docx`, `.doc`, `.txt`)
            </div>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              className="hidden"
              id="resume-file-input"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setSelectedFile(file);
                  void handleFileUpload(file);
                }
              }}
            />
            <label
              htmlFor="resume-file-input"
              className="inline-block cursor-pointer py-2 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Choose PDF / DOCX File
            </label>
            {selectedFile && (
              <p className="text-xs text-emerald-500 font-mono">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>

          <div className="relative flex items-center justify-center my-2">
            <span className="bg-card px-2 text-xs text-muted-foreground uppercase">OR PASTE TEXT</span>
            <div className="absolute inset-0 flex items-center -z-10"><div className="w-full border-t border-border"></div></div>
          </div>

          <div className="space-y-3">
            <textarea
              className="w-full h-32 p-3 text-xs font-mono rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Or paste raw CV text here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              onClick={handleTextUpload}
              disabled={isUploading || !pasteText.trim()}
              className="w-full py-2.5 px-4 rounded-md bg-secondary text-secondary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity text-xs"
            >
              {isUploading ? "Uploading & Processing..." : "Process Text Resume ➔"}
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
                Live Pipeline Execution
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

        {/* Career Intent Panel */}
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
