import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { DossierView } from "../DossierView";
import type { Dossier } from "../contracts";
import "../../styles.css";

interface Status {
  dossier?: Dossier;
  stage: string;
  error?: string;
  running: boolean;
  opportunity?: Dossier["opportunity"];
}
function App() {
  const [status, setStatus] = useState<Status>({ stage: "Loading memo", running: false });
  const [connectionError, setConnectionError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/dossier");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(await response.json());
      setConnectionError("");
    } catch {
      setConnectionError(
        "The local dossier service is unavailable. Check that the development server is running.",
      );
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  if (status.dossier) return <DossierView dossier={status.dossier} />;
  return (
    <main className="dossier dossier-launch">
      <span className="dossier-brand">RADAR</span>
      <h1>Your executive memo.</h1>
      <p role="status">{status.stage}</p>
      {(status.error || connectionError) && (
        <>
          <p role="alert">{status.error || connectionError}</p>
          <button onClick={() => void refresh()}>Try again</button>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
