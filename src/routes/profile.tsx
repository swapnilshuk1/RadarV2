import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  uploadDocumentFn,
  getPipelineStatusFn,
  saveIntentFn,
  getLatestIntentFn
} from "../lib/intelligence/document-server";
import { useOnboarding } from "../components/onboarding/OnboardingProvider";
import { useAttentionPreference } from "../lib/attention-store";

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
  const [parsing, setParsing] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();

  const { attentionWindow, setAttentionWindow } = useAttentionPreference();
  const { progress, markEvidenceProvided, markEvidenceSkipped, markIntentSet, markIntentSkipped } = useOnboarding();

  const isEvidenceStage = progress.orientationSeen && progress.evidenceStatus === "pending";
  const isIntentStage = progress.orientationSeen && progress.evidenceStatus !== "pending" && progress.intentStatus === "pending";

  // Intent form state
  const [currency, setCurrency] = useState<"" | "INR" | "USD" | "EUR" | "GBP">(
    (intent as any)?.currency || ""
  );
  const [targetSalary, setTargetSalary] = useState<string>(
    String((intent as any)?.targetSalaryAmount || (intent as any)?.minSalaryUsd || "")
  );
  const [locations, setLocations] = useState((intent?.preferredLocations || []).join(", "));
  const [targetTitles, setTargetTitles] = useState((intent?.targetTitles || []).join(", "));
  const [workModel, setWorkModel] = useState<"" | "HYBRID" | "REMOTE" | "ON_SITE" | "ANY">(intent?.preferredWorkModel || "");
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
            markEvidenceProvided();
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
  }, [activeDocId, pipelineStatus, router, markEvidenceProvided]);

  const fileToBase64 = (fileToConvert: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(fileToConvert);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setPipelineStage("DOCUMENT_REGISTERED");
    setPipelineStatus("PROCESSING");

    try {
      const base64Buffer = await fileToBase64(file);

      const res = await uploadDocumentFn({
        data: {
          filename: file.name,
          mimeType: file.type || "application/pdf",
          base64Buffer
        }
      });

      if (res.success && res.documentId) {
        setActiveDocId(res.documentId);
        markEvidenceProvided();
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
        markEvidenceProvided();
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
          currency: currency || undefined,
          targetSalaryAmount: targetSalary.trim() ? Number(targetSalary) : undefined,
          // Non-USD salary remains in its source currency until an explicit
          // FX conversion record is supplied by a canonical conversion path.
          minSalaryUsd: currency === "USD" && targetSalary.trim() ? Number(targetSalary) : undefined,
          preferredLocations: locList,
          targetTitles: titleList,
          preferredWorkModel: workModel || undefined
        }
      });

      setIntentSavedMsg("Career intent saved (new version created)!");
      markIntentSet();
      await router.invalidate();
      navigate({ to: "/" });
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
    { id: "PROFILE_READY", label: "Profile Ready — Career Intent Required" },
    { id: "EVALUATED", label: "Executive Briefs & Similarity Scores Refreshed" },
    { id: "COMPLETED", label: "Complete" }
  ];

  const getStageIndex = (stageId: string | null) => {
    if (!stageId) return -1;
    return stages.findIndex(s => s.id === stageId);
  };

  const currentStageIdx = getStageIndex(pipelineStage);

  let headerEyebrow = "◆ EXECUTIVE ADVISORY PROFILE";
  let headerTitle = "Executive Profile & Intent";
  let headerSubtitle = "Upload your executive résumé (PDF, Word DOCX, Plain Text) to extract immutable evidence claims, and explicitly configure your target career intent.";

  if (isEvidenceStage) {
    headerEyebrow = "◆ STAGE 1 — CAREER EVIDENCE";
    headerTitle = "Start with your career evidence";
    headerSubtitle = "Upload your CV. RADAR will use your actual career history — roles, scale, achievements and experience — to understand where you are strongest.";
  } else if (isIntentStage) {
    headerEyebrow = "◆ STAGE 2 — CAREER DIRECTION";
    headerTitle = "Tell RADAR where you want to go";
    headerSubtitle = "Your CV tells us where you've been. Your career intent tells us what you're looking for next.";
  }

  return (
    <div className="mx-auto max-w-[1080px] px-4 sm:px-8 py-10 sm:py-14 space-y-12 text-foreground">
      {/* Header */}
      <div className="border-b border-border/60 pb-8 transition-all duration-300">
        <span className="mono text-[10px] tracking-[0.24em] font-bold uppercase text-foreground/80 block mb-2">
          {headerEyebrow}
        </span>
        <h1 className="font-serif text-[2.75rem] sm:text-[3.25rem] font-light tracking-tight leading-[1.05] text-foreground">
          {headerTitle}
        </h1>
        <p className="mt-3 font-serif text-[15px] italic text-muted-foreground max-w-3xl leading-relaxed">
          {headerSubtitle}
        </p>
      </div>

      {/* Grid Layout — Continuous Composition */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        {/* Document Upload Zone */}
        <div
          className={`p-8 rounded-sm border bg-card shadow-xs space-y-6 transition-all duration-300 ${
            isEvidenceStage
              ? "border-foreground shadow-md ring-1 ring-foreground/20"
              : isIntentStage
              ? "border-border/60 opacity-70 hover:opacity-100"
              : "border-border/80"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <span className="mono text-[11px] tracking-[0.22em] text-foreground font-bold uppercase">
              ◆ RÉSUMÉ &amp; EVIDENCE INGESTION
            </span>
            <span className="mono text-[10px] text-muted-foreground/70 uppercase">
              {isEvidenceStage ? "Active Setup" : isIntentStage ? "Evidence Logged" : "Stage 1 / 2"}
            </span>
          </div>

          {/* Evidence status callout when in Intent stage */}
          {isIntentStage && (
            <div className="p-3.5 bg-muted/40 border border-border/60 rounded-xs text-[11.5px] font-mono leading-relaxed">
              {progress.evidenceStatus === "provided" ? (
                <span className="text-emerald-800 font-bold block">✓ Career evidence registered</span>
              ) : (
                <span className="text-muted-foreground block">
                  ℹ Career evidence pending — upload your CV anytime to sharpen recommendation accuracy.
                </span>
              )}
            </div>
          )}

          {/* Native File Upload Dropzone */}
          <div className="border border-dashed border-border/80 rounded-sm p-8 text-center space-y-4 bg-muted/10 hover:border-foreground transition-all cursor-pointer">
            <div className="mono text-[22px]">📄</div>
            <div>
              <p className="text-[13.5px] font-semibold text-foreground">
                Upload Executive Résumé
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                Supports `.pdf`, `.docx`, `.doc`, `.txt`, `.md`
              </p>
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
              className="mono inline-block cursor-pointer py-2.5 px-5 rounded-sm border border-foreground bg-foreground text-background text-[11px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
            >
              Choose PDF / DOCX File
            </label>
            {selectedFile && (
              <p className="mono text-[11px] text-emerald-800 font-bold mt-2">
                ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>

          <div className="relative flex items-center justify-center my-2">
            <span className="mono bg-card px-3 text-[10px] text-muted-foreground uppercase font-bold tracking-widest z-10">
              OR PASTE CV TEXT
            </span>
            <div className="absolute inset-0 flex items-center -z-0">
              <div className="w-full border-t border-border/60"></div>
            </div>
          </div>

          <div className="space-y-3">
            <textarea
              className="w-full h-32 p-3 text-[12px] font-mono rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
              placeholder="Or paste raw CV text here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              type="button"
              onClick={handleTextUpload}
              disabled={isUploading || !pasteText.trim()}
              className="mono w-full py-2.5 px-4 rounded-sm border border-foreground bg-foreground text-background font-bold text-[11px] uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isUploading ? "Uploading & Processing..." : "Process Text Resume ➔"}
            </button>
          </div>

          {/* Onboarding Skip Link for Evidence */}
          {isEvidenceStage && (
            <div className="pt-2 text-center border-t border-border/40">
              <button
                type="button"
                onClick={() => markEvidenceSkipped()}
                className="mono text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
              >
                I'll do this later →
              </button>
            </div>
          )}

          {uploadError && (
            <div className="mono p-3 text-[11px] rounded-xs border border-red-500/50 bg-red-950/5 text-red-700 font-medium">
              ⚠ {uploadError}
            </div>
          )}

          {/* Pipeline Stage Stepper */}
          {activeDocId && (
            <div className="mt-6 pt-5 border-t border-border/60 space-y-3">
              <span className="mono text-[10px] tracking-[0.2em] font-bold uppercase text-foreground/80 block">
                LIVE PIPELINE EXECUTION
              </span>
              <div className="space-y-2">
                {stages.map((st, idx) => {
                  const isDone = currentStageIdx > idx || pipelineStatus === "COMPLETED";
                  const isCurrent = currentStageIdx === idx && pipelineStatus !== "COMPLETED";
                  return (
                    <div
                      key={st.id}
                      className={`mono flex items-center gap-2.5 text-[11px] p-2 rounded-xs transition-colors ${
                        isDone
                          ? "text-emerald-800 font-bold bg-emerald-950/5"
                          : isCurrent
                          ? "text-foreground font-bold bg-muted/60 animate-pulse border border-border/60"
                          : "text-muted-foreground/50 font-normal"
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
        <form
          onSubmit={handleSaveIntent}
          className={`p-8 rounded-sm border bg-card shadow-xs space-y-6 transition-all duration-300 ${
            isIntentStage
              ? "border-foreground shadow-md ring-1 ring-foreground/20"
              : isEvidenceStage
              ? "border-border/60 opacity-70 hover:opacity-100"
              : "border-border/80"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <span className="mono text-[11px] tracking-[0.22em] text-emerald-800 font-bold uppercase">
              ◆ STRATEGIC CAREER INTENT
            </span>
            <span className="mono text-[10px] text-muted-foreground/70 uppercase">
              {isIntentStage ? "Active Setup" : "HUMAN CONFIG"}
            </span>
          </div>

          <p className="text-[13px] text-muted-foreground leading-relaxed font-serif italic">
            Career intent is explicitly configured by you. It is never assumed or inferred from past CV evidence.
          </p>

          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                  CURRENCY
                </label>
                <select
                  className="w-full p-2.5 text-[13px] font-mono rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as any)}
              >
                <option value="">Not specified</option>
                <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                  TARGET MIN SALARY ({currency === "INR" ? "₹ INR" : currency === "EUR" ? "€ EUR" : currency === "GBP" ? "£ GBP" : "$ USD"})
                </label>
                <input
                  type="number"
                  className="w-full p-2.5 text-[13px] font-mono rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                  placeholder={currency === "INR" ? "8000000 (80 Lakhs)" : "150000"}
                value={targetSalary}
                onChange={(e) => setTargetSalary(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                PREFERRED LOCATIONS
              </label>
              <input
                type="text"
                className="w-full p-2.5 text-[13px] font-sans rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
              />
            </div>

            <div>
              <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                TARGET EXECUTIVE TITLES
              </label>
              <input
                type="text"
                className="w-full p-2.5 text-[13px] font-sans rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                value={targetTitles}
                onChange={(e) => setTargetTitles(e.target.value)}
              />
            </div>

            <div>
              <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                PREFERRED WORK MODEL
              </label>
              <select
                className="w-full p-2.5 text-[13px] font-mono rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                value={workModel}
                onChange={(e) => setWorkModel(e.target.value as any)}
              >
                <option value="">Not specified</option>
                <option value="ANY">ANY (Flexible / All Models)</option>
                <option value="HYBRID">HYBRID</option>
                <option value="REMOTE">REMOTE</option>
                <option value="ON_SITE">ON_SITE</option>
              </select>
            </div>

            <div>
              <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">
                EXECUTIVE ATTENTION WINDOW (1–10 OPPORTUNITIES)
              </label>
              <select
                className="w-full p-2.5 text-[13px] font-mono rounded-xs border border-border/80 bg-background focus:outline-none focus:border-foreground"
                value={attentionWindow}
                onChange={(e) => setAttentionWindow(Number(e.target.value))}
                data-testid="attention-window-select"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 6 ? "(Default — 6 Opportunities)" : `Opportunity${n > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Controls presentation density without restricting access to the broader pipeline.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSavingIntent}
              className="mono w-full py-3 px-4 rounded-sm border border-foreground bg-foreground text-background font-bold text-[11px] uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity mt-2 cursor-pointer"
            >
              {isSavingIntent ? "Saving Intent Version..." : "Save Career Intent Version ➔"}
            </button>

            {/* Onboarding Skip Link for Intent */}
            {isIntentStage && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    markIntentSkipped();
                    navigate({ to: "/" });
                  }}
                  className="mono text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
                >
                  Take me to my shortlist →
                </button>
              </div>
            )}

            {intentSavedMsg && (
              <p className="mono text-[11px] text-emerald-800 font-bold text-center mt-2">
                ✓ {intentSavedMsg}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
