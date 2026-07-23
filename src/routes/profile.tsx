import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { 
  getCandidateStateFn, 
  ingestEvidenceFn, 
  updateIdentityStateFn, 
  updateIntentSessionFn 
} from "../lib/intelligence/profile-server";
import { type CandidateState } from "../types/candidate";

export const Route = createFileRoute("/profile")({
  component: ProfileComponent,
});

function ProfileDashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState<CandidateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"synthesis" | "intent" | "ledger">("synthesis");

  // Onboarding Step State (if not onboarded)
  const [step, setStep] = useState<"upload" | "intent" | "complete" | null>(null);

  // Ingestion inputs
  const [pasteText, setPasteText] = useState("");
  const [ingesting, setIngesting] = useState(false);

  // Intent form inputs
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [newLocation, setNewLocation] = useState("");
  const [workModel, setWorkModel] = useState<"Hybrid" | "Remote" | "Onsite" | "Any">("Hybrid");
  const [maxMonthlyPursuits, setMaxMonthlyPursuits] = useState(5);

  // Identity Form inputs (for editing)
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [valueProposition, setValueProposition] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [newTheme, setNewTheme] = useState("");
  const [largestTeam, setLargestTeam] = useState(10);
  const [budgetScale, setBudgetScale] = useState("$1M");
  const [boardExposure, setBoardExposure] = useState(false);
  const [achievements, setAchievements] = useState<string[]>([]);
  const [newAchievement, setNewAchievement] = useState("");

  const [saving, setSaving] = useState(false);
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  useEffect(() => {
    // 1. Enforce auth session
    const sessionStr = sessionStorage.getItem("radar_session");
    if (!sessionStr) {
      navigate({ to: "/login" });
      return;
    }
    const session = JSON.parse(sessionStr);

    // 2. Fetch state from server
    getCandidateStateFn()
      .then((res) => {
        setState(res);
        setLoading(false);

        // Load intent inputs
        setTargetRoles(res.intent.targetRoles.map(r => r.title));
        setLocations(res.intent.locations);
        setWorkModel(res.intent.workModel);
        setMaxMonthlyPursuits(res.intent.maxMonthlyPursuits);

        // Load identity inputs
        setName(session.name || "Swapnil Shukla");
        setArchetype(res.identity.identity.archetype);
        setValueProposition(res.identity.identity.valueProposition);
        setThemes(res.identity.identity.executiveThemes);
        setLargestTeam(res.identity.leadership.largestTeam);
        setBudgetScale(res.identity.leadership.budgetScale);
        setBoardExposure(res.identity.leadership.boardExposure);
        setAchievements(res.identity.achievements);

        // If the user's local session is not onboarded, launch the onboarding wizard!
        if (!session.onboarded && res.sources.length <= 1) {
          setStep("upload");
        }
      })
      .catch((err) => {
        console.error("Failed to load candidate state:", err);
        setLoading(false);
      });
  }, [navigate]);

  const handleSignOut = () => {
    sessionStorage.removeItem("radar_session");
    navigate({ to: "/login" });
  };

  const [uploadMode, setUploadMode] = useState<"file" | "paste">("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleIngestResult = (res: any) => {
    if (res.success && res.state) {
      setState(res.state);
      setPasteText("");
      setSelectedFile(null);
      setAchievements(res.state.identity.achievements);
      setArchetype(res.state.identity.identity.archetype);
      setValueProposition(res.state.identity.identity.valueProposition);
      setThemes(res.state.identity.identity.executiveThemes);
      setLargestTeam(res.state.identity.leadership.largestTeam);
      setBudgetScale(res.state.identity.leadership.budgetScale);
      setBoardExposure(res.state.identity.leadership.boardExposure);

      if (step === "upload") {
        setStep("intent");
      } else {
        alert("Evidence successfully ingested and compiled by Identity Engine!");
      }
    } else {
      alert(`Ingestion failed: ${res.error}`);
    }
    setIngesting(false);
  };

  const handleIngest = async () => {
    if (uploadMode === "file") {
      if (!selectedFile) return alert("Please select a Resume file (PDF or DOCX) first.");
      setIngesting(true);
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64Data = (reader.result as string).split(",")[1];
            const res = await ingestEvidenceFn({
              data: {
                sourceName: selectedFile.name,
                sourceFileBase64: base64Data,
                sourceMimeType: selectedFile.type || "application/octet-stream",
                sourceType: "Resume"
              }
            });
            handleIngestResult(res);
          } catch (err: any) {
            alert(`Ingestion failed: ${err.message}`);
            setIngesting(false);
          }
        };
        reader.onerror = () => {
          alert("Failed to read file.");
          setIngesting(false);
        };
        reader.readAsDataURL(selectedFile);
      } catch (err: any) {
        alert(`Ingestion failed: ${err.message}`);
        setIngesting(false);
      }
    } else {
      if (!pasteText.trim()) return alert("Please paste resume/LinkedIn text first.");
      setIngesting(true);
      try {
        const res = await ingestEvidenceFn({
          data: {
            sourceName: `Uploaded_CV_${new Date().toLocaleDateString().replace(/\//g, "-")}.txt`,
            sourceText: pasteText,
            sourceType: "Resume"
          }
        });
        handleIngestResult(res);
      } catch (err: any) {
        alert(`Ingestion failed: ${err.message}`);
        setIngesting(false);
      }
    }
  };

  const saveIdentity = async () => {
    setSaving(true);
    try {
      const updated = await updateIdentityStateFn({
        data: {
          name,
          archetype,
          valueProposition,
          themes,
          largestTeam,
          budgetScale,
          boardExposure,
          achievements
        }
      });
      setState(updated);
      alert("Executive profile compiled & saved successfully!");
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveIntent = async () => {
    setSaving(true);
    try {
      const updated = await updateIntentSessionFn({
        data: {
          targetRoles,
          locations,
          workModel,
          maxMonthlyPursuits
        }
      });
      setState(updated);
      
      // Update session storage session
      const session = JSON.parse(sessionStorage.getItem("radar_session") || "{}");
      session.onboarded = true;
      sessionStorage.setItem("radar_session", JSON.stringify(session));

      if (step === "intent") {
        setStep("complete");
      } else {
        alert("Career Intent & Scraper Search Plan updated successfully!");
      }
    } catch (err: any) {
      alert(`Failed to save intent: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment text-ink">
        <div className="text-center space-y-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink border-t-transparent mx-auto" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted font-medium">Loading Candidate Intelligence...</span>
        </div>
      </div>
    );
  }

  // ─── RENDERING THE ONBOARDING WIZARD ───────────────────────────────────────
  if (step === "upload") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-parchment text-ink font-sans antialiased">
        <div className="relative w-full max-w-2xl px-6">
          <div className="rounded-md border border-hairline bg-card p-10 shadow-[0_12px_40px_rgba(0,0,0,0.03)] space-y-8">
            <div className="text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink-muted font-semibold">Step 1 of 2</span>
              <h1 className="mt-2 font-serif text-3xl text-ink font-medium tracking-tight">Upload Executive Experience</h1>
              <p className="mt-3 text-sm text-ink-muted font-light max-w-md mx-auto leading-relaxed">
                Provide your CV or LinkedIn summary to begin. Our Gemini Fact Engine will extract verifiable evidence to compile your initial capability claims.
              </p>
            </div>

            <div className="flex justify-center border-b border-hairline pb-4">
              <div className="inline-flex rounded-md p-1 bg-parchment border border-hairline">
                <button
                  type="button"
                  onClick={() => setUploadMode("file")}
                  className={`px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider font-semibold transition-all ${
                    uploadMode === "file"
                      ? "bg-ink text-parchment shadow-sm"
                      : "text-ink-muted hover:text-ink cursor-pointer"
                  }`}
                >
                  Upload File (PDF / DOCX)
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("paste")}
                  className={`px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider font-semibold transition-all ${
                    uploadMode === "paste"
                      ? "bg-ink text-parchment shadow-sm"
                      : "text-ink-muted hover:text-ink cursor-pointer"
                  }`}
                >
                  Paste Raw Text
                </button>
              </div>
            </div>

            {uploadMode === "file" ? (
              <div className="space-y-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      const file = e.dataTransfer.files[0];
                      const ext = file.name.split('.').pop()?.toLowerCase();
                      if (ext === 'pdf' || ext === 'docx') {
                        setSelectedFile(file);
                      } else {
                        alert("Only PDF or DOCX resume formats are supported.");
                      }
                    }
                  }}
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-10 transition-all ${
                    dragActive
                      ? "border-ink bg-muted/50 scale-[1.01]"
                      : "border-hairline hover:border-ink/30 bg-parchment/30"
                  }`}
                >
                  <input
                    type="file"
                    id="file-upload"
                    accept=".pdf,.docx"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  <label htmlFor="file-upload" className="flex flex-col items-center cursor-pointer space-y-4">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center border border-hairline shadow-sm">
                      <span className="text-xl text-ink">↑</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink block">
                        {selectedFile ? selectedFile.name : "Drag & drop CV or Click to browse"}
                      </span>
                      <span className="text-[11px] text-ink-muted block mt-1 font-light">
                        Supports high-fidelity PDF & Word Documents (.docx)
                      </span>
                    </div>
                  </label>
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="mt-4 text-[10px] font-mono uppercase tracking-wider text-red-600 hover:underline cursor-pointer"
                    >
                      Remove File
                    </button>
                  )}
                </div>
                <button
                  onClick={handleIngest}
                  disabled={ingesting || !selectedFile}
                  className="w-full rounded-md bg-ink py-3.5 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-40 cursor-pointer"
                >
                  {ingesting ? "Gemini Extraction Engine Compiling..." : "Parse & Verify Document Experience"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste full text of your CV / Resume here... (e.g. past companies, roles, key achievements, budgets and team sizes managed)"
                  className="w-full h-64 rounded-md border border-hairline bg-parchment p-4 text-[13px] text-ink font-light placeholder-ink-muted/50 focus:border-ink/20 focus:outline-none resize-none leading-relaxed"
                />
                <button
                  onClick={handleIngest}
                  disabled={ingesting || !pasteText.trim()}
                  className="w-full rounded-md bg-ink py-3.5 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-40 cursor-pointer"
                >
                  {ingesting ? "Gemini Extraction Engine Compiling..." : "Ingest and Verify Text Experience"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === "intent") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-parchment text-ink font-sans antialiased">
        <div className="relative w-full max-w-xl px-6">
          <div className="rounded-md border border-hairline bg-card p-10 shadow-[0_12px_40px_rgba(0,0,0,0.03)] space-y-8">
            <div className="text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink-muted font-semibold">Step 2 of 2</span>
              <h1 className="mt-2 font-serif text-3xl text-ink font-medium tracking-tight">Set Search & Career Intent</h1>
              <p className="mt-3 text-sm text-ink-muted font-light max-w-sm mx-auto leading-relaxed">
                Define the dynamic target titles and locations you are actively pursuing. This auto-generates your Scraper Search Plan.
              </p>
            </div>

            <div className="space-y-6">
              {/* Target Roles */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted">Target Executive Roles / Titles</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="e.g. Chief Marketing Officer"
                    className="flex-1 rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[13px] text-ink placeholder-ink-muted/50 focus:outline-none focus:border-ink/20"
                  />
                  <button
                    onClick={() => {
                      if (newRole.trim()) {
                        setTargetRoles([...targetRoles, newRole.trim()]);
                        setNewRole("");
                      }
                    }}
                    className="rounded-md bg-ink text-parchment px-5 text-xs font-semibold uppercase tracking-wider border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {targetRoles.map((role, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 py-1.5 text-[11.5px] text-ink font-medium">
                      {role}
                      <button onClick={() => setTargetRoles(targetRoles.filter(r => r !== role))} className="text-ink-muted hover:text-ink font-bold ml-1 cursor-pointer">&times;</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Target Locations */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted">Target Locations</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Mumbai, Remote"
                    className="flex-1 rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[13px] text-ink placeholder-ink-muted/50 focus:outline-none focus:border-ink/20"
                  />
                  <button
                    onClick={() => {
                      if (newLocation.trim()) {
                        setLocations([...locations, newLocation.trim()]);
                        setNewLocation("");
                      }
                    }}
                    className="rounded-md bg-ink text-parchment px-5 text-xs font-semibold uppercase tracking-wider border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {locations.map((loc, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 py-1.5 text-[11.5px] text-ink font-medium">
                      {loc}
                      <button onClick={() => setLocations(locations.filter(l => l !== loc))} className="text-ink-muted hover:text-ink font-bold ml-1 cursor-pointer">&times;</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Capacity Limit */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted">Bandwidth Saturation Limit (Capacity)</label>
                <input
                  type="number"
                  value={maxMonthlyPursuits}
                  onChange={(e) => setMaxMonthlyPursuits(parseInt(e.target.value) || 5)}
                  className="w-full rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[13px] text-ink focus:outline-none focus:border-ink/20"
                />
                <p className="text-[11px] text-ink-muted font-light leading-relaxed">Active pursues exceeding this limit will automatically downgrade recommendations to reconsider.</p>
              </div>

              <button
                onClick={saveIntent}
                disabled={saving}
                className="w-full rounded-md bg-ink py-3.5 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Compiling Scraper Search Plan..." : "Complete Setup & Launch RADAR"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === "complete") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-parchment text-ink font-sans antialiased">
        <div className="relative w-full max-w-md px-6 text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink/5 text-ink border border-hairline shadow-sm">
            <svg className="h-8 w-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
          <div className="space-y-2">
            <h1 className="font-serif text-3xl text-ink font-medium tracking-tight">Intelligence Active</h1>
            <p className="text-sm text-ink-muted font-light leading-relaxed max-w-xs mx-auto">
              Your Evidence Ledger is loaded, Identity compiled, and career searches have been fully synchronized with the Scraper Search Plan.
            </p>
          </div>
          <button
            onClick={() => {
              setStep(null);
              navigate({ to: "/" });
            }}
            className="w-full rounded-md bg-ink py-3.5 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
          >
            Open Shortlist Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── THE CORE PROFILE DASHBOARD ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-parchment text-ink antialiased pb-20 font-sans">
      {/* Main Area */}
      <main className="mx-auto max-w-4xl px-4 sm:px-8 mt-12 grid grid-cols-1 md:grid-cols-12 gap-8">
        
        {/* Left Column: Stats & Tabs */}
        <div className="md:col-span-4 space-y-6">
          
          {/* Identity Confidence Card */}
          <div className="rounded-md border border-hairline bg-card p-6 shadow-sm">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-muted block mb-1 font-semibold">Synthesis Coverage</span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-serif text-ink font-medium tracking-tight">{state.identity.identityConfidence}%</span>
              <span className="text-[11.5px] text-ink-muted font-light">Identity Strength</span>
            </div>
            
            <div className="mt-5 space-y-3 border-t border-hairline pt-4">
              <div className="flex justify-between text-[12.5px]">
                <span className="text-ink-muted font-light">Evidence Facts</span>
                <span className="text-ink font-semibold font-mono">{state.identity.evidenceCount} items</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-ink-muted font-light">Quantified Outcomes</span>
                <span className="text-ink font-semibold font-mono">{state.identity.quantifiedOutcomesCount} metrics</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-ink-muted font-light">Compiled Claims</span>
                <span className="text-ink font-semibold font-mono">{state.claims.length} claims</span>
              </div>
            </div>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("synthesis")}
              className={`text-left px-4 py-3 rounded-md text-[13px] font-medium tracking-wide transition-all ${activeTab === "synthesis" ? "bg-card border border-hairline text-ink font-semibold shadow-sm" : "text-ink-muted hover:bg-card/40 hover:text-ink cursor-pointer"}`}
            >
              Emergent Claims & Identity
            </button>
            <button
              onClick={() => setActiveTab("intent")}
              className={`text-left px-4 py-3 rounded-md text-[13px] font-medium tracking-wide transition-all ${activeTab === "intent" ? "bg-card border border-hairline text-ink font-semibold shadow-sm" : "text-ink-muted hover:bg-card/40 hover:text-ink cursor-pointer"}`}
            >
              Active Career Intent
            </button>
            <button
              onClick={() => setActiveTab("ledger")}
              className={`text-left px-4 py-3 rounded-md text-[13px] font-medium tracking-wide transition-all ${activeTab === "ledger" ? "bg-card border border-hairline text-ink font-semibold shadow-sm" : "text-ink-muted hover:bg-card/40 hover:text-ink cursor-pointer"}`}
            >
              Evidence Ledger
            </button>
          </div>

          <button
            onClick={handleSignOut}
            className="w-full mt-4 rounded-md border border-hairline bg-card py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted hover:bg-muted hover:text-ink cursor-pointer transition-all active:scale-[0.98] text-center"
          >
            Sign Out
          </button>

        </div>

        {/* Right Column: Workspaces */}
        <div className="md:col-span-8 space-y-6">

          {/* ────────────────── Tab 1: SYNTHESIS ────────────────── */}
          {activeTab === "synthesis" && (
            <div className="space-y-6">
              
              {/* Executive Header Controls */}
              <div className="rounded-md border border-hairline bg-card p-6 space-y-6 shadow-sm">
                <div className="border-b border-hairline pb-4">
                  <h2 className="font-serif text-xl text-ink font-medium tracking-tight">Candidate Identity Configuration</h2>
                  <p className="text-[12px] text-ink-muted mt-1 font-light">Dynamically derived attributes projected by your Evidence Ledger.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Candidate Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[13px] text-ink focus:outline-none focus:border-ink/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Emergent Archetype</label>
                    <input
                      type="text"
                      value={archetype}
                      onChange={(e) => setArchetype(e.target.value)}
                      className="w-full rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[13px] text-ink focus:outline-none focus:border-ink/20"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Value Proposition Summary</label>
                  <textarea
                    value={valueProposition}
                    onChange={(e) => setValueProposition(e.target.value)}
                    className="w-full h-24 rounded-md border border-hairline bg-parchment p-3.5 text-[13px] text-ink focus:outline-none focus:border-ink/20 resize-none leading-relaxed"
                  />
                </div>

                {/* Themes */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Core Executive Themes</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTheme}
                      onChange={(e) => setNewTheme(e.target.value)}
                      placeholder="Add custom theme..."
                      className="flex-1 rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[12.5px] text-ink focus:outline-none focus:border-ink/20"
                    />
                    <button
                      onClick={() => {
                        if (newTheme.trim()) {
                          setThemes([...themes, newTheme.trim()]);
                          setNewTheme("");
                        }
                      }}
                      className="rounded-md bg-ink text-parchment px-5 text-xs font-semibold uppercase tracking-wider border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1.5">
                    {themes.map((theme, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 py-1 text-[11.5px] text-ink font-semibold">
                        {theme}
                        <button onClick={() => setThemes(themes.filter(t => t !== theme))} className="text-ink-muted hover:text-ink ml-1 font-bold cursor-pointer">&times;</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Scale Stats */}
                <div className="grid grid-cols-3 gap-4 border-t border-hairline pt-4">
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-ink-muted block font-semibold">Team Managed</span>
                    <input
                      type="number"
                      value={largestTeam}
                      onChange={(e) => setLargestTeam(parseInt(e.target.value) || 0)}
                      className="w-full rounded-md border border-hairline bg-parchment px-2 py-1.5 text-[13px] text-ink focus:outline-none focus:border-ink/20"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-ink-muted block font-semibold">Fee Book Scale</span>
                    <input
                      type="text"
                      value={budgetScale}
                      onChange={(e) => setBudgetScale(e.target.value)}
                      className="w-full rounded-md border border-hairline bg-parchment px-2 py-1.5 text-[13px] text-ink focus:outline-none focus:border-ink/20"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-ink-muted block font-semibold">Board Interaction</span>
                    <div className="flex items-center gap-2 h-9">
                      <input
                        type="checkbox"
                        checked={boardExposure}
                        onChange={(e) => setBoardExposure(e.target.checked)}
                        className="rounded border-hairline bg-parchment text-ink h-4 w-4 cursor-pointer focus:ring-0"
                      />
                      <span className="text-[12.5px] text-ink font-semibold">Exposed</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={saveIdentity}
                  disabled={saving}
                  className="w-full rounded-md bg-ink py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Re-Compiling..." : "Save Executive Claims & Identity"}
                </button>
              </div>

              {/* Emergent Claims List */}
              <div className="space-y-4">
                <h3 className="font-serif text-[17px] text-ink font-semibold px-1">Verifiable Capability Claims</h3>
                <div className="space-y-3">
                  {state.claims.map((claim) => {
                    const isExpanded = expandedClaimId === claim.id;
                    return (
                      <div key={claim.id} className="rounded-md border border-hairline bg-card overflow-hidden shadow-sm">
                        <button
                          onClick={() => setExpandedClaimId(isExpanded ? null : claim.id)}
                          className="w-full flex items-center justify-between p-5 hover:bg-muted/40 text-left transition-all cursor-pointer"
                        >
                          <div>
                            <span className="inline-block rounded-md bg-muted border border-hairline text-ink font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 mb-1.5 font-bold">
                              {claim.type} Claim
                            </span>
                            <h4 className="text-[13.5px] font-semibold tracking-wide text-ink">{claim.title}</h4>
                            <p className="text-[12px] text-ink-muted mt-1 font-light line-clamp-2 leading-relaxed">{claim.statement}</p>
                          </div>
                          <span className="text-ink-muted/50 ml-4 font-mono text-xs">{isExpanded ? "▲" : "▼"}</span>
                        </button>
                        
                        {isExpanded && (
                          <div className="bg-muted/30 border-t border-hairline p-5 space-y-4">
                            <div className="space-y-2.5">
                              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Supporting Verbatim Evidence:</span>
                              {claim.supportingFactIds.map((factId) => {
                                const fact = state.facts.find(f => f.id === factId);
                                if (!fact) return null;
                                return (
                                  <div key={factId} className="border-l-2 border-ink/20 pl-4 py-1.5">
                                    <p className="text-[12.5px] text-ink italic font-serif leading-relaxed">"{fact.verbatimQuote}"</p>
                                    <div className="flex gap-2 items-center mt-2.5">
                                      <span className="text-[10px] font-mono uppercase text-ink-muted">Source:</span>
                                      <span className="text-[11px] text-ink-muted font-mono">
                                        {state.sources.find(s => s.id === fact.evidenceId)?.name || "Primary Ledger"}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ────────────────── Tab 2: INTENT ────────────────── */}
          {activeTab === "intent" && (
            <div className="rounded-md border border-hairline bg-card p-6 space-y-6 shadow-sm">
              <div className="border-b border-hairline pb-4">
                <h2 className="font-serif text-xl text-ink font-medium tracking-tight">Dynamic Active Career Intent</h2>
                <p className="text-[12px] text-ink-muted mt-1 font-light">Workspace state that filters searches and evaluates opportunities on-the-fly.</p>
              </div>

              {/* Target Roles */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Target Titles / Queries</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="e.g. CMO"
                    className="flex-1 rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[12.5px] text-ink focus:outline-none focus:border-ink/20"
                  />
                  <button
                    onClick={() => {
                      if (newRole.trim()) {
                        setTargetRoles([...targetRoles, newRole.trim()]);
                        setNewRole("");
                      }
                    }}
                    className="rounded-md bg-ink text-parchment px-5 text-xs font-semibold uppercase tracking-wider border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {targetRoles.map((role, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 py-1 text-[11.5px] text-ink font-semibold">
                      {role}
                      <button onClick={() => setTargetRoles(targetRoles.filter(r => r !== role))} className="text-ink-muted hover:text-ink ml-1 font-bold cursor-pointer">&times;</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Target Locations */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Target Locations</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Mumbai"
                    className="flex-1 rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[12.5px] text-ink focus:outline-none focus:border-ink/20"
                  />
                  <button
                    onClick={() => {
                      if (newLocation.trim()) {
                        setLocations([...locations, newLocation.trim()]);
                        setNewLocation("");
                      }
                    }}
                    className="rounded-md bg-ink text-parchment px-5 text-xs font-semibold uppercase tracking-wider border border-ink transition-all hover:bg-parchment hover:text-ink cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {locations.map((loc, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 py-1 text-[11.5px] text-ink font-semibold">
                      {loc}
                      <button onClick={() => setLocations(locations.filter(l => l !== loc))} className="text-ink-muted hover:text-ink ml-1 font-bold cursor-pointer">&times;</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Work Model Preference</label>
                  <select
                    value={workModel}
                    onChange={(e) => setWorkModel(e.target.value as any)}
                    className="w-full rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[12.5px] text-ink focus:outline-none focus:border-ink/20 cursor-pointer"
                  >
                    <option value="Hybrid">Hybrid Workspace</option>
                    <option value="Remote">Remote Only</option>
                    <option value="Onsite">Onsite Only</option>
                    <option value="Any">No Model Preference (Any)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-semibold uppercase tracking-widest text-ink-muted block">Bandwidth Pursuit Limit (Capacity)</label>
                  <input
                    type="number"
                    value={maxMonthlyPursuits}
                    onChange={(e) => setMaxMonthlyPursuits(parseInt(e.target.value) || 5)}
                    className="w-full rounded-md border border-hairline bg-parchment px-3.5 py-2.5 text-[12.5px] text-ink focus:outline-none focus:border-ink/20"
                  />
                </div>
              </div>

              <button
                onClick={saveIntent}
                disabled={saving}
                className="w-full rounded-md bg-ink py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Updating Search Plan..." : "Update Career Intent & Search Planner"}
              </button>
            </div>
          )}

          {/* ────────────────── Tab 3: LEDGER ────────────────── */}
          {activeTab === "ledger" && (
            <div className="space-y-6">
              
              {/* Evidence Ingest Card */}
              <div className="rounded-md border border-hairline bg-card p-6 space-y-6 shadow-sm">
                <div className="border-b border-hairline pb-4">
                  <h2 className="font-serif text-xl text-ink font-medium tracking-tight">Evidence Ingestion Pipeline</h2>
                  <p className="text-[12px] text-ink-muted mt-1 font-light">Append new evidence credentials to your ledger using Gemini 2.5 Flash.</p>
                </div>

                <div className="flex justify-center border-b border-hairline pb-4">
                  <div className="inline-flex rounded-md p-1 bg-parchment border border-hairline">
                    <button
                      type="button"
                      onClick={() => setUploadMode("file")}
                      className={`px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider font-semibold transition-all ${
                        uploadMode === "file"
                          ? "bg-ink text-parchment shadow-sm"
                          : "text-ink-muted hover:text-ink cursor-pointer"
                      }`}
                    >
                      Upload File (PDF / DOCX)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadMode("paste")}
                      className={`px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider font-semibold transition-all ${
                        uploadMode === "paste"
                          ? "bg-ink text-parchment shadow-sm"
                          : "text-ink-muted hover:text-ink cursor-pointer"
                      }`}
                    >
                      Paste Raw Text
                    </button>
                  </div>
                </div>

                {uploadMode === "file" ? (
                  <div className="space-y-4">
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragActive(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          const file = e.dataTransfer.files[0];
                          const ext = file.name.split('.').pop()?.toLowerCase();
                          if (ext === 'pdf' || ext === 'docx') {
                            setSelectedFile(file);
                          } else {
                            alert("Only PDF or DOCX resume formats are supported.");
                          }
                        }
                      }}
                      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md p-10 transition-all ${
                        dragActive
                          ? "border-ink bg-muted/50 scale-[1.01]"
                          : "border-hairline hover:border-ink/30 bg-parchment/30"
                      }`}
                    >
                      <input
                        type="file"
                        id="tab-file-upload"
                        accept=".pdf,.docx"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setSelectedFile(e.target.files[0]);
                          }
                        }}
                        className="hidden"
                      />
                      <label htmlFor="tab-file-upload" className="flex flex-col items-center cursor-pointer space-y-4">
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center border border-hairline shadow-sm">
                          <span className="text-xl text-ink">↑</span>
                        </div>
                        <div className="text-center">
                          <span className="text-xs font-semibold uppercase tracking-wider text-ink block">
                            {selectedFile ? selectedFile.name : "Drag & drop CV or Click to browse"}
                          </span>
                          <span className="text-[11px] text-ink-muted block mt-1 font-light">
                            Supports high-fidelity PDF & Word Documents (.docx)
                          </span>
                        </div>
                      </label>
                      {selectedFile && (
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="mt-4 text-[10px] font-mono uppercase tracking-wider text-red-600 hover:underline cursor-pointer"
                        >
                          Remove File
                        </button>
                      )}
                    </div>
                    <button
                      onClick={handleIngest}
                      disabled={ingesting || !selectedFile}
                      className="w-full rounded-md bg-ink py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                    >
                      {ingesting ? "Ingesting Fact Ledger..." : "Ingest New Evidence Document"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste resume text, project summaries, or LinkedIn bio here..."
                      className="w-full h-44 rounded-md border border-hairline bg-parchment p-4 text-[12.5px] text-ink placeholder-ink-muted/50 focus:border-ink/20 focus:outline-none resize-none leading-relaxed"
                    />
                    <button
                      onClick={handleIngest}
                      disabled={ingesting || !pasteText.trim()}
                      className="w-full rounded-md bg-ink py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-parchment border border-ink transition-all hover:bg-parchment hover:text-ink active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                    >
                      {ingesting ? "Ingesting Fact Ledger..." : "Ingest New Evidence String"}
                    </button>
                  </div>
                )}
              </div>

              {/* Evidence Sources List */}
              <div className="space-y-4">
                <h3 className="font-serif text-[17px] text-ink font-semibold px-1">Ledger History ({state.sources.length} sources)</h3>
                <div className="space-y-2">
                  {state.sources.map((source) => (
                    <div key={source.id} className="rounded-md border border-hairline bg-card p-5 flex items-center justify-between shadow-sm">
                      <div>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-muted font-semibold block">Source Document</span>
                        <h4 className="text-[13.5px] font-semibold text-ink mt-1">{source.name}</h4>
                        <div className="flex gap-2 items-center text-[11px] text-ink-muted mt-1 font-light">
                          <span>Provenance: {source.type}</span>
                          <span>·</span>
                          <span>Uploaded: {new Date(source.uploadedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="h-2 w-2 rounded-full bg-emerald-600" />
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>

      </main>

    </div>
  );
}

function ProfileComponent() {
  return <ProfileDashboard />;
}
