import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  uploadDocumentFn,
  getPipelineStatusFn,
  saveIntentFn,
  getLatestIntentFn,
  getProfileOverviewFn,
  getDefaultProfileScopeFn
} from "../lib/intelligence/document-server";
import { useOnboarding } from "../components/onboarding/OnboardingProvider";
import { useAttentionPreference } from "../lib/attention-store";
import { getUserPreferencesFn } from "../lib/intelligence/preferences-server";
import { PROFILE_PIPELINE_STAGES, isIntentRequiredProfileState, resolveProfilePipelineStepState } from "../lib/intelligence/profile-pipeline-presentation";
import { resolveIntentActivationPresentation } from "../lib/intelligence/profile-intent-presentation";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Executive Intent — RADAR" },
      { name: "description", content: "Upload executive resume (PDF, DOCX, TXT) and configure career intent." }
    ]
  }),
  loader: async ({ location }) => {
    const raw = location.search as { tenantId?: unknown; personId?: unknown };
    const deps = { tenantId: typeof raw.tenantId === "string" ? raw.tenantId : undefined, personId: typeof raw.personId === "string" ? raw.personId : undefined };
    if (Boolean(deps.tenantId) !== Boolean(deps.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
    const scope = deps.tenantId && deps.personId ? { tenantId: deps.tenantId, personId: deps.personId } : await getDefaultProfileScopeFn();
    const [intent, overview, preferences] = await Promise.all([
      getLatestIntentFn({ data: scope }),
      getProfileOverviewFn({ data: scope }),
      getUserPreferencesFn(),
    ]);
    return { intent, scope, overview, initialAttentionWindow: preferences.preferences.attentionWindow };
  },
  component: ProfileRoute
});

function ProfileRoute() {
  const { scope } = Route.useLoaderData();
  return <ProfilePage key={`${scope.tenantId}:${scope.personId}`} />;
}

function ProfilePage() {
  const { intent, scope, overview, initialAttentionWindow } = Route.useLoaderData();
  const requireScope = useCallback(() => {
    return scope;
  }, [scope]);
  const [parsing, setParsing] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();

  const { attentionWindow, setAttentionWindow, saveStatus } = useAttentionPreference(initialAttentionWindow);
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
  const decisionPreferences = (intent as any)?.decisionPreferences || {};
  const [desiredNextRoleLevel, setDesiredNextRoleLevel] = useState<string>(decisionPreferences.desiredNextRoleLevel || "");
  const [careerMove, setCareerMove] = useState<string>(decisionPreferences.careerMove || "");
  const [leadershipPreference, setLeadershipPreference] = useState<string>(decisionPreferences.leadershipPreference || "");
  const [minimumTeamSize, setMinimumTeamSize] = useState<string>(decisionPreferences.minimumTeamSize == null ? "" : String(decisionPreferences.minimumTeamSize));
  const [minimumCommercialScope, setMinimumCommercialScope] = useState<string>(decisionPreferences.minimumCommercialScope || "");
  const [travelTolerance, setTravelTolerance] = useState<"" | "HIGH" | "MEDIUM" | "LOW">((intent as any)?.travelTolerance || "");
  const [startupStageAppetite, setStartupStageAppetite] = useState<string[]>(decisionPreferences.startupStageAppetite || []);
  const [founderInterest, setFounderInterest] = useState<string>(decisionPreferences.founderInterest || "");
  const [personalCapitalInvestment, setPersonalCapitalInvestment] = useState<string>(decisionPreferences.personalCapitalInvestment || "");
  const [compensationPreference, setCompensationPreference] = useState<string>(decisionPreferences.compensationPreference || "");
  const [timeZoneTolerance, setTimeZoneTolerance] = useState<string>(decisionPreferences.timeZoneTolerance || "");
  const [industriesSought, setIndustriesSought] = useState<string>((decisionPreferences.industriesSought || []).join(", "));
  const [industriesAvoided, setIndustriesAvoided] = useState<string>((decisionPreferences.industriesAvoided || []).join(", "));
  const [nonNegotiables, setNonNegotiables] = useState<string>((decisionPreferences.nonNegotiables || []).join("\n"));
  const [isSavingIntent, setIsSavingIntent] = useState(false);
  const [intentSavedMsg, setIntentSavedMsg] = useState("");
  const [intentActivationPending, setIntentActivationPending] = useState(false);

  // Upload & Pipeline state
  const [pasteText, setPasteText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(overview.document?.id || null);
  const [pipelineStage, setPipelineStage] = useState<string | null>(overview.document?.stage || null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(overview.document?.status || null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const displayedPipelineStage = intent ? "COMPLETED" : pipelineStage;

  // Poll pipeline stage status when a document upload is in progress
  useEffect(() => {
    if (!activeDocId || pipelineStatus === "COMPLETED" || pipelineStatus === "FAILED") return;

    const interval = setInterval(async () => {
      try {
        const res = await getPipelineStatusFn({ data: { ...requireScope(), documentId: activeDocId } });
        if (res.success && res.stage) {
          setPipelineStage(res.stage);
          setPipelineStatus(res.status || "PROCESSING");

          if (res.status === "COMPLETED") {
            markEvidenceProvided();
            setIsUploading(false);
            await router.invalidate();
          } else if (res.status === "FAILED") {
            setUploadError(res.errorMessage || "Pipeline processing failed.");
            setIsUploading(false);
          }
        }
      } catch (err: any) {
        console.error("Status check error:", err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeDocId, pipelineStatus, router, markEvidenceProvided, requireScope]);

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
          ...requireScope(),
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
          ...requireScope(),
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
      const list = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
      const lines = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const candidateDecisionPreferences = {
        desiredNextRoleLevel: desiredNextRoleLevel.trim() || undefined,
        careerMove: careerMove || undefined,
        leadershipPreference: leadershipPreference || undefined,
        minimumTeamSize: minimumTeamSize.trim() ? Number(minimumTeamSize) : undefined,
        minimumCommercialScope: minimumCommercialScope || undefined,
        startupStageAppetite: startupStageAppetite.length ? startupStageAppetite : undefined,
        founderInterest: founderInterest || undefined,
        personalCapitalInvestment: personalCapitalInvestment || undefined,
        compensationPreference: compensationPreference || undefined,
        timeZoneTolerance: timeZoneTolerance || undefined,
        industriesSought: list(industriesSought).length ? list(industriesSought) : undefined,
        industriesAvoided: list(industriesAvoided).length ? list(industriesAvoided) : undefined,
        nonNegotiables: lines(nonNegotiables).length ? lines(nonNegotiables) : undefined,
      };
      const hasDecisionPreferences = Object.values(candidateDecisionPreferences).some(value => value !== undefined);

      const result = await saveIntentFn({
        data: {
          ...requireScope(),
          currency: currency || undefined,
          targetSalaryAmount: targetSalary.trim() ? Number(targetSalary) : undefined,
          // Non-USD salary remains in its source currency until an explicit
          // FX conversion record is supplied by a canonical conversion path.
          minSalaryUsd: currency === "USD" && targetSalary.trim() ? Number(targetSalary) : undefined,
          preferredLocations: locList,
          targetTitles: titleList,
          preferredWorkModel: workModel || undefined,
          travelTolerance: travelTolerance || undefined,
          decisionPreferences: hasDecisionPreferences ? candidateDecisionPreferences as any : undefined
        }
      });
      const presentation = resolveIntentActivationPresentation(result);
      setIntentSavedMsg(presentation.message);
      setIntentActivationPending(presentation.activationPending);
      if (!presentation.persisted) throw new Error(presentation.message);
      markIntentSet();
      await router.invalidate();
      if (presentation.navigateHome) navigate({ to: "/" });
    } catch (err: any) {
      console.error("Save intent failed:", err);
    } finally {
      setIsSavingIntent(false);
    }
  };

  const stages: Array<{ id: typeof PROFILE_PIPELINE_STAGES[number]; label: string }> = [
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

  let headerEyebrow = "◆ EXECUTIVE ADVISORY PROFILE";
  let headerTitle = "Executive Profile & Intent";
  let headerSubtitle = "Upload your executive résumé (PDF, Word DOCX, Plain Text) to use your career evidence and set your next career direction.";

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
          {overview.name} · {headerSubtitle}
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

          <div role="status" className="rounded border p-3 text-sm">
            {overview.document ? <><strong>Current résumé: {overview.document.filename}</strong><p>{overview.document.status === "COMPLETED" ? "Career evidence ready" : overview.document.status === "FAILED" ? "Processing failed — upload again to retry" : "Résumé processing in progress"}</p>{overview.document.errorMessage && <p>{overview.document.errorMessage}</p>}</> : "No résumé uploaded yet."}
          </div>
          {/* Native File Upload Dropzone */}
          <div className="border border-dashed border-border/80 rounded-sm p-8 text-center space-y-4 bg-muted/10 hover:border-foreground transition-all cursor-pointer">
            <div className="mono text-[22px]">📄</div>
            <div>
              <p className="text-[13.5px] font-semibold text-foreground">
                Upload Executive Résumé
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                   Supports `.pdf`, `.docx`, `.txt`
              </p>
            </div>
            <input
              type="file"
                accept=".pdf,.docx,.txt"
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
              Choose résumé file
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
                {stages.map((st) => {
                  const stepState = resolveProfilePipelineStepState(displayedPipelineStage, st.id);
                  const isDone = stepState === "complete";
                  const isCurrent = stepState === "current";
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
              {isIntentRequiredProfileState(displayedPipelineStage) && (
                <p className="mt-3 text-sm text-caution">Profile evidence is ready. Save explicit career intent before recommendation evaluation can begin.</p>
              )}
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

            <div className="border-t border-border/60 pt-5 space-y-4">
              <div>
                <span className="mono text-[10px] tracking-[0.18em] uppercase font-bold text-foreground/80 block">
                  CAREER DECISION PREFERENCES
                </span>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Optional. Blank means RADAR does not know your preference and must not assume it.
                </p>
              </div>

              <div>
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">DESIRED NEXT-ROLE LEVEL</label>
                <input className="w-full p-2.5 text-[13px] rounded-xs border border-border/80 bg-background" value={desiredNextRoleLevel} onChange={(e) => setDesiredNextRoleLevel(e.target.value)} placeholder="e.g. CMO / SVP+ / founder-level" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">CAREER MOVE SOUGHT</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={careerMove} onChange={(e) => setCareerMove(e.target.value)}>
                    <option value="">Not specified</option>
                    <option value="PROGRESSION">Progression</option>
                    <option value="LATERAL">Similar-scale move</option>
                    <option value="DELIBERATE_RESET">Deliberate reset</option>
                    <option value="FOUNDER">Founder / co-founder</option>
                    <option value="PORTFOLIO">Portfolio / fractional</option>
                  </select>
                </div>
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">LEADERSHIP PREFERENCE</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={leadershipPreference} onChange={(e) => setLeadershipPreference(e.target.value)}>
                    <option value="">Not specified</option>
                    <option value="LEADERSHIP">People leadership</option>
                    <option value="PLAYER_COACH">Player-coach</option>
                    <option value="INDIVIDUAL_CONTRIBUTOR">Individual contributor</option>
                    <option value="ANY">Any</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">MINIMUM TEAM SIZE</label>
                  <input type="number" min="0" className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={minimumTeamSize} onChange={(e) => setMinimumTeamSize(e.target.value)} placeholder="Blank = not specified" />
                </div>
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">FOUNDER INTEREST</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={founderInterest} onChange={(e) => setFounderInterest(e.target.value)}>
                    <option value="">Not specified</option><option value="YES">Yes</option><option value="OPEN">Open to it</option><option value="NO">No</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">MINIMUM COMMERCIAL SCOPE</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={minimumCommercialScope} onChange={(e) => setMinimumCommercialScope(e.target.value)}>
                    <option value="">Not specified</option>
                    <option value="FUNCTIONAL">Functional ownership</option>
                    <option value="BUDGET_OWNERSHIP">Budget ownership</option>
                    <option value="REVENUE_OWNERSHIP">Revenue ownership</option>
                    <option value="PNL_OWNERSHIP">P&amp;L ownership</option>
                    <option value="ENTERPRISE">Enterprise-wide commercial scope</option>
                  </select>
                </div>
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">TRAVEL TOLERANCE</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={travelTolerance} onChange={(e) => setTravelTolerance(e.target.value as any)}>
                    <option value="">Not specified</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-2">STARTUP STAGES YOU WOULD CONSIDER</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["ESTABLISHED", "Established"],
                    ["SCALE_UP", "Scale-up"],
                    ["EARLY_STAGE", "Early stage"],
                    ["PRE_REVENUE", "Pre-revenue"],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-[12px]">
                      <input type="checkbox" checked={startupStageAppetite.includes(value)} onChange={(e) => setStartupStageAppetite(current => e.target.checked ? [...current, value] : current.filter(item => item !== value))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">PERSONAL CAPITAL INVESTMENT</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={personalCapitalInvestment} onChange={(e) => setPersonalCapitalInvestment(e.target.value)}>
                    <option value="">Not specified</option><option value="YES">Willing</option><option value="OPEN">Open / depends</option><option value="NO">Not willing</option>
                  </select>
                </div>
                <div>
                  <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">CASH / EQUITY PREFERENCE</label>
                  <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={compensationPreference} onChange={(e) => setCompensationPreference(e.target.value)}>
                    <option value="">Not specified</option><option value="CASH_PRIORITY">Cash priority</option><option value="BALANCED">Balanced</option><option value="EQUITY_PRIORITY">Equity priority</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">TIME-ZONE TOLERANCE</label>
                <select className="w-full p-2.5 text-[12px] font-mono rounded-xs border border-border/80 bg-background" value={timeZoneTolerance} onChange={(e) => setTimeZoneTolerance(e.target.value)}>
                  <option value="">Not specified</option><option value="LOCAL_HOURS">Local business hours</option><option value="LIMITED_OVERLAP">Limited off-hours overlap</option><option value="US_HOURS_OK">US hours acceptable</option><option value="ANY">Any</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">INDUSTRIES TO SEEK</label><input className="w-full p-2.5 text-[12px] rounded-xs border border-border/80 bg-background" value={industriesSought} onChange={(e) => setIndustriesSought(e.target.value)} placeholder="Comma-separated" /></div>
                <div><label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">INDUSTRIES TO AVOID</label><input className="w-full p-2.5 text-[12px] rounded-xs border border-border/80 bg-background" value={industriesAvoided} onChange={(e) => setIndustriesAvoided(e.target.value)} placeholder="Comma-separated" /></div>
              </div>

              <div>
                <label className="mono text-[10px] tracking-[0.16em] uppercase font-bold text-foreground/80 block mb-1.5">NON-NEGOTIABLES</label>
                <textarea className="w-full h-24 p-2.5 text-[12px] rounded-xs border border-border/80 bg-background" value={nonNegotiables} onChange={(e) => setNonNegotiables(e.target.value)} placeholder={"One per line\nExample: no relocation"} />
              </div>
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
                    {n} {n === 6 ? "(Default — 6 Opportunities)" : n === 1 ? "Opportunity" : "Opportunities"}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Sets how many opportunities appear at once. Changes save automatically for your account.
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
                    navigate({ to: "/", search: scope });
                  }}
                  className="mono text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
                >
                  Take me to my shortlist →
                </button>
              </div>
            )}

            {saveStatus && <p role="status" className="text-sm">{saveStatus}</p>}
            {intentSavedMsg && (
              <p className={`mono text-[11px] font-bold text-center mt-2 ${intentActivationPending ? "text-caution" : "text-emerald-800"}`}>
                ✓ {intentSavedMsg}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
