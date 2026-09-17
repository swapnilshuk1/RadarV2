import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { DossierView } from '../DossierView';
import type { Dossier } from '../contracts';
import '../../styles.css';

interface Status { dossier?: Dossier; stage: string; error?: string; running: boolean; opportunity?: Dossier['opportunity'] }
function App() {
  const [status,setStatus] = useState<Status>({stage:'Loading sources',running:false});
  const [connectionError,setConnectionError] = useState('');
  async function refresh() {
    try { const response = await fetch('/api/dossier'); if (!response.ok) throw new Error(`HTTP ${response.status}`); setStatus(await response.json()); setConnectionError(''); }
    catch { setConnectionError('The local dossier service is unavailable. Check that the development server is running.'); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(refresh,2500); return () => clearInterval(timer); },[]);
  async function generate() {
    try { const response = await fetch('/api/dossier',{method:'POST'}); if (!response.ok) throw new Error('Generation could not start'); setStatus(await response.json()); }
    catch { setConnectionError('Generation could not start. Check the local service.'); }
  }
  if (status.dossier) return <DossierView dossier={status.dossier}/>;
  return <main className="dossier dossier-launch"><span className="dossier-brand">RADAR</span><h1>A decision worth thinking through.</h1><p>{status.opportunity?.title}<br/>{status.opportunity?.company}</p><p>The original job description, both candidate CVs and acquired company context will inform one dossier, available in two editorial views.</p><button disabled={status.running} onClick={generate}>{status.running ? 'Preparing your dossier…' : 'Generate dossier'}</button><p role="status">{status.stage}</p>{(status.error || connectionError) && <p role="alert">{status.error || connectionError}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
