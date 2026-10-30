import { useWorkspaceLoading } from './hooks/useWorkspaceLoading';
import { useAccount } from './hooks/useAccount';
import { useRepositoryPolling } from './hooks/useRepositoryPolling';
import { EvidenceView } from './components/EvidenceView';
import { TimelineView } from './components/TimelineView';
import { AnswerView } from './components/AnswerView';
import { SourceInspector } from './components/SourceInspector';
import { date, SourceLink } from './components/SourcePresentation';
import { Icon } from './components/Icon';
import { api } from './lib/api';
import { restoreWorkspaceHistory, clearWorkspaceHistory } from './lib/workspace-history';
import { FormEvent, KeyboardEvent, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccountDialog } from './components/AccountDialog';
import { Brand } from './components/Brand';
import { SiteFooter } from './components/SiteFooter';
import { HomeStory } from './components/HomeStory';
import { BranchCompanion } from './components/BranchCompanion';
const ConnectionsView=lazy(()=>import('./components/ConnectionsView').then(module=>({default:module.ConnectionsView})));
import type { Counts, Repository, Evidence, Answer, Graph, Health } from './types/workspace';
type Tab = 'answer' | 'evidence' | 'timeline' | 'graph';
const initialCounts: Counts = { commits: 0, files: 0, pullRequests: 0, issues: 0, comments: 0, documents: 0 };
const terminal = (r: Repository) => !['queued', 'running'].includes(r.status);
const ready = (r: Repository | null) => r && ['complete', 'partial'].includes(r.status);
export default function App() {
  const [session, setSession] = useState<{ required: boolean; authenticated: boolean } | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [privateConsent, setPrivateConsent] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const workspacePrefix = privateMode ? '/private' : '';
  const [health, setHealth] = useState<Health | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]); const [selected, setSelected] = useState<string | null>(null);
  const [repositoryInput, setRepositoryInput] = useState(''); const [depth, setDepth] = useState(25); const [connecting, setConnecting] = useState(false); const [addingRepository, setAddingRepository] = useState(false);
  const [question, setQuestion] = useState(''); const [language, setLanguage] = useState('en'); const [webContext, setWebContext] = useState(false);
  const [history, setHistory] = useState<Answer[]>([]); const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false); const [elapsed, setElapsed] = useState(0); const [tab, setTab] = useState<Tab>('answer');
  const [inspecting, setInspecting] = useState<string | null>(null); const [graph, setGraph] = useState<Graph | null>(null);
  const [graphBusy, setGraphBusy] = useState(false); const [graphError, setGraphError] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pollError, setPollError] = useState('');
  const { account, accountOpen, setAccountOpen, refreshAccount, recovery, setRecovery } = useAccount({ session, setPrivateMode, setPrivateConsent, setNotice });
  const [guestImport, setGuestImport] = useState<{ repositories: number; investigations: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [legacyHistory, setLegacyHistory] = useState(false);
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [page, setPage] = useState(() => window.location.pathname);
  const [mobileNav, setMobileNav] = useState(false); const [copied, setCopied] = useState(false);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  const workspaceLoad = useRef(0); const loadedScope = useRef('');
  const version = useRef(0); const graphVersion = useRef(0); const hydrated = useRef(false);
  const repoInputRef = useRef<HTMLInputElement>(null); const questionRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const isWorkspace = page === '/workspace' && Boolean(account?.user);
  function navigate(path: string) { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }
  useEffect(() => { const sync = () => setPage(window.location.pathname); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  useEffect(() => { if (page === '/workspace' && account && !account.user) navigate('/'); }, [page, account]);
  const repository = repositories.find(item => item.repositoryId === selected) ?? null;
  const currentHistory = selected ? history.filter(item => item.repositoryId === selected) : account?.user ? history : history.filter(item => repositories.some(repo => repo.repositoryId === item.repositoryId));
  const source = answer?.evidence.find(item => item.id === inspecting) ?? answer?.evidence.find(item => answer.citedEvidenceIds.includes(item.id)) ?? answer?.evidence[0];
  const working = repository && !terminal(repository);
  const serviceReady = (privateMode || health?.dependencies.database === 'connected') && health?.dependencies.answerProvider?.startsWith('configured:');
  const loadWorkspace = useWorkspaceLoading({ privateMode, userId: account?.user?.id, githubLogin: account?.github?.login,
    generation: workspaceLoad, loadedScope, hydrated, setRepositories, setHealth, setHistory, setSelected, setAnswer, setNotice });
  useEffect(() => { let cancelled = false; api<{ required: boolean; authenticated: boolean }>('/auth/session').then(async value => { if (cancelled) return; setSession(value); if (value.authenticated || (privateMode && account?.github)) await loadWorkspace(); }).catch(reason => { if (!cancelled) setError(reason.message); }); return () => { cancelled = true; workspaceLoad.current++; }; }, [loadWorkspace]);
  useEffect(() => {
    let active = true;
    if (!account?.user) { setGuestImport(null); return; }
    api<{ repositories: number; investigations: number }>('/account/workspace/guest-preview')
      .then(value => { if (active) setGuestImport(value); }).catch(() => { if (active) setGuestImport(null); });
    return () => { active = false; };
  }, [account?.user?.id]);
  useEffect(() => {
    if (!account?.user) { setLegacyHistory(false); return; }
    try { setLegacyHistory(Boolean(window.localStorage.getItem('whycode.workspace.v2'))); }
    catch { setLegacyHistory(false); }
  }, [account?.user?.id]);
  useEffect(() => { if (!asking) { setElapsed(0); return; } const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [asking]);
  useRepositoryPolling(repository, workspacePrefix, setRepositories, setPollError);
  useEffect(() => {
    const expired = () => { workspaceLoad.current++; hydrated.current = false; setPrivateMode(false); setPrivateConsent(false); setAccountOpen(true); setNotice('Your account session needs verification. Sign in again to access private repositories.'); void refreshAccount().catch(() => {}); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMobileNav(false); };
    window.addEventListener('whycode:unauthorized', expired); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('whycode:unauthorized', expired); window.removeEventListener('keydown', escape); };
  }, [refreshAccount]);
  useLayoutEffect(() => {
    let frame=0,attempts=0;
    if (mobileNav) {
      drawerWasOpen.current=true;
      const focus=()=>{
        const target=drawerCloseRef.current,drawer=target?.closest('aside');
        if(drawer?.contains(document.activeElement))return;
        if(target && !target.closest('[inert]') && getComputedStyle(target).visibility==='visible')target.focus({preventScroll:true});
        if(document.activeElement!==target && attempts++<10)frame=requestAnimationFrame(focus);
      };
      frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(focus);});
    }
    else if (drawerWasOpen.current) { drawerWasOpen.current=false;archiveButtonRef.current?.focus({preventScroll:true}); }
    return ()=>cancelAnimationFrame(frame);
  }, [mobileNav]);
  useEffect(() => {
    const elements = document.querySelectorAll('[data-reveal], [data-scroll-reveal]');
    if (!motion || !('IntersectionObserver' in window)) { elements.forEach(element => element.setAttribute('data-visible', 'true')); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-visible', 'true'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    elements.forEach(element => observer.observe(element)); return () => observer.disconnect();
  }, [selected, answer?.answeredAt, tab, motion, session?.authenticated, addingRepository, accountOpen, page, isWorkspace]);
  function returnHome() {
    version.current++; graphVersion.current++; setSelected(null); setAnswer(null); setQuestion(''); setAsking(false); setMobileNav(false); setAddingRepository(false); setError('');
    window.history.replaceState(null, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: motion ? 'smooth' : 'auto' });
  }
  function trapDrawer(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  function addRepository() { setAddingRepository(true); setMobileNav(false); requestAnimationFrame(() => repoInputRef.current?.focus()); }
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setMotion(!preference.matches);
    preference.addEventListener('change', change); return () => preference.removeEventListener('change', change);
  }, []);
  function chooseRepository(item: Repository) {
    version.current++; graphVersion.current++; setSelected(item.repositoryId); setAddingRepository(false); setRepositoryInput('');
    const previous = history.find(entry => entry.repositoryId === item.repositoryId) ?? null;
    setAnswer(previous); setQuestion(''); setTab('answer'); setInspectorOpen(false); setGraph(null); setError(''); setPollError(''); setAsking(false); setMobileNav(false); setInspecting(previous?.citedEvidenceIds[0] ?? null);
    requestAnimationFrame(() => questionRef.current?.focus());
  }
  async function connect(event?: FormEvent, value = repositoryInput, append = false) {
    event?.preventDefault(); if (connecting || !value.trim()) return;
    setRepositoryInput(value); setConnecting(true); setError(''); const requestVersion = ++version.current;
    try {
      const validated = await api<{ repository: string }>(`${workspacePrefix}/repositories/validate`, { repository: value });
      const job = await api<{ repositoryId: string; jobId: string; status: Repository['status']; workspaceWarning?: string }>(`${workspacePrefix}/repositories/ingest`, { repository: validated.repository, append, limits: { commits: depth, pullRequests: Math.min(depth, 100), issues: Math.min(depth, 100), comments: 50 } });
      if (requestVersion !== version.current) return;
      if (job.workspaceWarning) setNotice(job.workspaceWarning);
      const entry: Repository = { ...job, repository: validated.repository, counts: append ? repository?.counts ?? initialCounts : initialCounts, history: append ? repository?.history : undefined, progress: { phase: 'Queued', completed: 0, total: 6 }, warnings: [], errors: [] };
      setRepositories(previous => [entry, ...previous.filter(item => item.repositoryId !== entry.repositoryId)]);
      setSelected(entry.repositoryId); setAddingRepository(false); setAnswer(null); setGraph(null); setQuestion(''); setAsking(false); setTab('answer'); setRepositoryInput(''); setMobileNav(false);
      api<Health>(`${workspacePrefix}/health`).then(setHealth).catch(() => {});
    } catch (reason) { if (requestVersion === version.current) setError(reason instanceof Error ? reason.message : 'The repository could not be connected.'); }
    finally { setConnecting(false); }
  }
  async function ask(event?: FormEvent) {
    event?.preventDefault(); if (!ready(repository) || asking || !question.trim()) return;
    setError(''); setInspectorOpen(false); setAsking(true); setAnswer(null); setGraph(null); setTab('answer'); const requestVersion = version.current;
    try {
      const result = await api<Answer>(`${workspacePrefix}/ask`, { allowPrivateModel: privateMode && privateConsent, repositoryId: selected, question: question.trim(), language: privateMode ? 'en' : language, includeExternalContext: !privateMode && webContext });
      if (requestVersion !== version.current) return;
      setAnswer(result); setInspecting(result.citedEvidenceIds[0] ?? result.evidence[0]?.id ?? null); setHistory(previous => [result, ...previous].slice(0, 20)); requestAnimationFrame(() => answerRef.current?.focus());
    } catch (reason) { if (requestVersion === version.current) setError(reason instanceof Error ? reason.message : 'This investigation could not be completed.'); }
    finally { if (requestVersion === version.current) setAsking(false); }
  }
  async function loadGraph(focus?: string) {
    if (!selected) return; const requestVersion = ++graphVersion.current; setGraphBusy(true); setGraphError('');
    try { const result = await api<Graph>(`${workspacePrefix}/repositories/${encodeURIComponent(selected)}/graph${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`); if (requestVersion === graphVersion.current) {
      setGraph(result);
      if (focus) requestAnimationFrame(() => document.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(focus)}"]`)?.focus());
    } }
    catch { if (requestVersion === graphVersion.current) setGraphError('The relationship map is unavailable. Retry when the database reconnects.'); }
    finally { if (requestVersion === graphVersion.current) setGraphBusy(false); }
  }
  function selectTab(next: Tab) { setTab(next); if (next === 'graph' && !graph) void loadGraph(); }
  function tabKeys(event: KeyboardEvent, index: number) {
    const tabs: Tab[] = ['answer', 'evidence', 'timeline', 'graph']; if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4;
    selectTab(tabs[next]); document.getElementById(`tab-${tabs[next]}`)?.focus();
  }
  function restore(item: Answer) { if (!repositories.some(repo => repo.repositoryId === item.repositoryId)) { setRepositoryInput(item.repositoryId.replace(/^github:/, '')); setAddingRepository(true); setMobileNav(false); setNotice('Reconnect this repository to reopen its saved investigation.'); requestAnimationFrame(() => repoInputRef.current?.focus()); return; } setSelected(item.repositoryId); setAddingRepository(false); version.current++; graphVersion.current++; setAsking(false); setAnswer(item); setQuestion(item.question); setTab('answer'); setGraph(null); setInspecting(item.citedEvidenceIds[0]); setError(''); setMobileNav(false); requestAnimationFrame(() => answerRef.current?.focus()); }
  async function removeInvestigation(item: Answer) {
    if (!window.confirm('Delete this investigation from your current workspace?')) return;
    try {
      if (item.savedId) await api('/account/workspace/history/remove', { id: item.savedId });
      else if (!privateMode) await api('/workspace/history/remove', { repositoryId: item.repositoryId, answeredAt: item.answeredAt });
      setHistory(previous => previous.filter(entry => entry.repositoryId !== item.repositoryId || entry.answeredAt !== item.answeredAt));
      if (answer?.repositoryId === item.repositoryId && answer.answeredAt === item.answeredAt) setAnswer(null);
      setNotice('Investigation deleted from this workspace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this investigation.'); }
  }
  async function importGuestWork() {
    if (importing) return;
    setImporting(true);
    try {
      const result = await api<{ imported: number; repositories: number }>('/account/workspace/import-guest', {});
      setGuestImport(null);
      if (privateMode) setPrivateMode(false); else await loadWorkspace();
      setNotice(`Copied ${result.imported} investigations and ${result.repositories} repositories to your account.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Guest work could not be imported.'); }
    finally { setImporting(false); }
  }
  async function importBrowserHistory() {
    if (importing || !window.confirm('Copy the old public history from this browser into your account? Import only if this history belongs to you. The original stays on this device.')) return;
    setImporting(true);
    try {
      const saved = restoreWorkspaceHistory(false);
      let imported = 0;
      for (const item of saved?.history ?? []) {
        const result = await api<{ imported: boolean }>('/account/workspace/import-browser', { answer: item });
        if (result.imported) imported++;
      }
      if (privateMode) setPrivateMode(false); else await loadWorkspace();
      setNotice(`Copied ${imported} investigations. The original browser history is still on this device.`);
    } catch (reason) { setError(reason instanceof Error ? `${reason.message} Original browser history was kept.` : 'Import could not finish. Original browser history was kept.'); }
    finally { setImporting(false); }
  }
  function removeOldBrowserHistory() {
    if (!window.confirm('Remove the old WhyCode history stored in this browser? This does not delete account investigations.')) return;
    try { clearWorkspaceHistory(); setLegacyHistory(false); setNotice('Old browser history removed from this device.'); }
    catch { setError('Browser history could not be removed.'); }
  }
  async function clearInvestigations() {
    if (!window.confirm('Delete all investigations from this workspace? Repository indexes will remain.')) return;
    try {
      if (account?.user && history.some(item => item.savedId)) await api('/account/workspace/history/clear', { visibility: privateMode ? 'private' : 'public' });
      if (!privateMode) await api('/workspace/history/clear', {});
      setHistory([]); setAnswer(null); setNotice('Investigations cleared from this workspace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not clear investigations.'); }
  }
  async function removeRepository(item: Repository) {
    const detail = privateMode ? 'The session-local index will also be removed. Your GitHub repository will not be changed.' : 'The GitHub repository and shared public index are not deleted.';
    if (!window.confirm(`Remove ${item.repository} and its investigations from this workspace? ${detail}`)) return;
    try {
      await api(`${workspacePrefix}/repositories/${encodeURIComponent(item.repositoryId)}/remove`, {});
      setRepositories(previous => previous.filter(entry => entry.repositoryId !== item.repositoryId));
      setHistory(previous => previous.filter(entry => entry.repositoryId !== item.repositoryId));
      if (selected === item.repositoryId) returnHome();
      setNotice('Repository removed from this temporary workspace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove this repository.'); }
  }
  useEffect(() => { version.current++; graphVersion.current++; setRepositories([]); setSelected(null); setHistory([]); setAnswer(null); setGraph(null); setQuestion(''); setLanguage('en'); setWebContext(false); setPrivateConsent(false); setAsking(false); setError(''); setAddingRepository(false); setRepositoryInput(''); setInspectorOpen(false); loadedScope.current = ''; hydrated.current = false; }, [privateMode, account?.user?.id, account?.github?.login]);
  function inspectSource(id: string | null) { setInspecting(id); setInspectorOpen(true); requestAnimationFrame(() => document.getElementById('source-inspector')?.focus()); }
  const suggestions = [
    { icon: 'clock', label: 'Trace a change', text: 'What change introduced README and who authored it?' },
    { icon: 'branch', label: 'Understand a decision', text: 'Why was the README file changed?' },
    { icon: 'code', label: 'Explore the project', text: 'What do the project documents explain about its architecture?' },
  ];
  if (!session) return <div className="startup-screen" role="status" aria-live="polite"><Brand /><div className="startup-content">{!error && <span className="startup-spinner" aria-hidden="true" />}<h1>{error ? 'Connection unavailable' : 'Opening WhyCode'}</h1><p>{error || 'Preparing your workspace…'}</p>{error && <button onClick={() => location.reload()} className="secondary">Retry connection</button>}</div></div>;
  if (accountOpen) return <div className="account-page"><header className="topbar account-page-header"><Brand onHome={() => navigate('/')} /><button className="account-return" onClick={() => { navigate(account?.user ? '/workspace' : '/'); setRecovery(false); }}>← {account?.user ? 'Back to workspace' : 'Back to WhyCode'}</button></header><main className="account-page-layout"><div className="account-page-story"><span className="account-story-index">THE WHYCODE WORKSPACE / 01</span><h1>Good questions<br /><em>start here.</em></h1><p>A little more context for the code you work with.</p><div className="account-story-note"><Icon name="shield" size={18} /><span>Connect only the repositories you choose.</span></div></div><AccountDialog open account={account} recovery={recovery} request={api} onClose={() => { setAccountOpen(false); setRecovery(false); }} onChange={refreshAccount} onResetComplete={() => setNotice('Password updated. Sign in with your new password.')} /></main></div>;
  if (page === '/help') return <div className="account-page"><header className="topbar account-page-header"><Brand onHome={() => navigate('/')} /><button className="account-return" onClick={() => navigate(account?.user ? '/workspace' : '/')}>← {account?.user ? 'Back to workspace' : 'Back to WhyCode'}</button></header><main className="help-page"><p className="eyebrow">A QUICK GUIDE TO WHYCODE</p><h1>From “what?” to <em>“why.”</em></h1><p className="help-page-intro">Three steps to a clearer understanding of your codebase.</p><ol><li><span>01</span><div><h2>Start with a repository</h2><p>Paste a public GitHub URL, or sign in and authorize selected private repositories. Start with recent commits and load older batches when needed.</p></div></li><li><span>02</span><div><h2>Ask a specific question</h2><p>Name a file, function, commit, or issue number to help WhyCode find relevant records.</p></div></li><li><span>03</span><div><h2>Follow the evidence</h2><p>Open the cited sources and compare the explanation with the records. Models can miss errors, so inspect the evidence.</p></div></li></ol><section><h2>Your data &amp; choices</h2><p>Questions and relevant excerpts go to the configured model provider. Guest work is temporary; account history is saved when account storage is available. You can remove work from your workspace.</p><p>Private questions require consent to send excerpts to the model and save answers. Private source indexes remain session-only.</p></section><button className="primary" onClick={() => navigate(account?.user ? '/workspace' : '/')}>Start exploring <Icon name="arrow" size={16} /></button></main></div>;
  return <div className={`workspace ${repository ? 'has-repository' : 'is-home'} ${motion ? 'motion-enabled' : 'motion-paused'}`}>
    <a className="skip-link" href="#main">Skip to investigation</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} role="dialog" aria-modal={mobileNav || undefined} aria-label="Repositories and history" aria-hidden={!mobileNav} inert={!mobileNav} onKeyDown={trapDrawer} id="workspace-navigation">
      <div className="sidebar-brand"><Brand onHome={returnHome} /><button ref={drawerCloseRef} className="icon-button" aria-label="Close archive" onClick={() => setMobileNav(false)}><Icon name="close" /></button></div>
      <div className="archive-heading"><p className="eyebrow">YOUR WORKSPACE</p><h2>Pick up a thread.</h2><p className="archive-description">Your repositories and recent questions, together.</p><button className="archive-connect" onClick={addRepository}><Icon name="plus" size={17} />Connect a repository<Icon name="arrow" size={16} /></button></div>
      {guestImport && (guestImport.repositories > 0 || guestImport.investigations > 0) && <div className="guest-import"><strong>Bring your guest work</strong><p>Copy {guestImport.repositories} repositories and {guestImport.investigations} investigations from this browser into your account.</p><button disabled={importing} onClick={() => void importGuestWork()}>{importing ? 'Importing…' : 'Import guest work'} →</button></div>}
      {legacyHistory && <div className="guest-import"><strong>Earlier browser history</strong><p>Old history on this device may belong to another person. Import only if it is yours.</p><div className="import-actions"><button disabled={importing} onClick={() => void importBrowserHistory()}>{importing ? 'Importing…' : 'Import history'} →</button><button disabled={importing} onClick={removeOldBrowserHistory}>Remove old history</button></div></div>}
      <div className="nav-section-label"><span>Repositories</span><span className="archive-section-count">{repositories.length}</span></div>
      <div className="repository-list">{repositories.length ? repositories.map(item => <button key={item.repositoryId} className={`repo-nav ${selected === item.repositoryId ? 'selected' : ''}`} aria-current={selected === item.repositoryId ? 'page' : undefined} onClick={() => chooseRepository(item)}><Icon name="github" size={17} /><span><strong>{item.repository.split('/')[1]}</strong><small>{item.repository.split('/')[0]}</small></span><span className="repo-nav-state">{item.status === 'partial' ? 'Partial index' : item.status === 'complete' ? 'Ready' : (item.status === 'running' || item.status === 'queued') ? 'Indexing' : 'Failed'}</span><span className={`repo-dot ${item.status}`} title={item.status} /></button>) : <p className="sidebar-empty">Your connected repositories<br />will appear here.</p>}</div>
      <div className="nav-section-label"><span>Recent investigations</span><span className="archive-section-count">{currentHistory.length}</span></div>
      <div className="history-list">{currentHistory.length ? currentHistory.slice(0, 8).map((item, index) => <div className="workspace-history-entry" key={`${item.answeredAt}-${index}`}><button onClick={() => restore(item)} className={`history-button ${item.answeredAt === answer?.answeredAt ? 'selected' : ''}`}><Icon name="clock" size={15} /><span><strong>{item.question}</strong><small>{item.repositoryId.replace('github:', '')} · {date(item.answeredAt)}</small></span></button><button className="workspace-delete" aria-label={`Delete investigation: ${item.question}`} disabled={asking} onClick={() => void removeInvestigation(item)}>×</button></div>) : <p className="sidebar-empty">A little curiosity goes a long way.<br />Ask your first question.</p>}</div>
      {history.length > 0 && <button className="clear-history" disabled={asking} onClick={() => void clearInvestigations()}>Clear investigations</button>}
      <div className="sidebar-bottom"><div className="workspace-note"><Icon name="shield" size={17} /><span>{account?.user ? 'Account workspace' : 'Guest workspace'}<small>{account?.user ? 'Saved history requires account storage.' : 'Temporary work · up to 8 hours.'}</small></span></div><div className="sidebar-footer"><span>Built for the curious.</span><span>v0.2</span></div></div>
    </aside>
    <div className="workspace-body" inert={mobileNav}>
      <BranchCompanion motion={motion} showTrail={!repository && !isWorkspace} />
      <header className="topbar"><Brand onHome={returnHome} /><nav className="topbar-actions" aria-label="Main navigation">{!repository && !isWorkspace && <a className="nav-story-link" href="#connected-context">The story<span>↗</span></a>}<button ref={archiveButtonRef} className="archive-button" aria-label="Open repositories and history" aria-expanded={mobileNav} aria-controls="workspace-navigation" onClick={() => setMobileNav(true)}><Icon name="clock" size={16} />Repositories<span className="archive-count">{repositories.length.toString().padStart(2, '0')}</span></button><button className="help-button" aria-label="How it works" onClick={() => navigate('/help')}><span className="method-label">Help</span><Icon name="book" size={14} /></button>{account?.user && !isWorkspace && <button className="archive-button" onClick={() => navigate('/workspace')}>My workspace <Icon name="arrow" size={14} /></button>}<button className={`account-button ${account?.user ? 'account-button-signed-in' : ''}`} onClick={() => setAccountOpen(true)} aria-label={account?.user ? `Account settings for ${account.user.email}` : 'Sign in'}>{account?.user ? <><span className="account-avatar" aria-hidden="true">{(account.user.email?.trim().charAt(0) || account.github?.login?.charAt(0) || '?').toUpperCase()}</span><span>Account</span></> : <>Sign in<Icon name="arrow" size={14} /></>}</button></nav></header>
      <main id="main" className="main-content">
        {!repository && !isWorkspace ? <section className="opening-scene"><div className="hero-copy"><p className="eyebrow hero-kicker"><span className="index-cross">+</span> THE FIELD GUIDE TO YOUR CODEBASE</p><h1 className="hero-title"><span className="reveal-line"><span>Read between</span></span><span className="reveal-line final-line"><span>the <em>lines.</em></span></span></h1><p className="hero-description">The code tells you what. Find the changes and conversations that help explain why.</p></div></section> : <div className="page-heading" data-reveal><div><p className="eyebrow">{isWorkspace && !repository ? 'YOUR WORKSPACE' : privateMode ? 'PRIVATE WORKSPACE' : 'REPOSITORY WORKSPACE'}</p><h1>{isWorkspace && !repository ? <>Welcome to your <em>workspace.</em></> : <>Understand your <em>repository.</em></>}</h1><p className="workspace-intro">{isWorkspace && !repository ? 'Your repositories and investigations, all in one place.' : 'Ask a question. Follow the history. Check the evidence.'}</p></div>{repository && <button className="text-button new-repository-button" onClick={addRepository}><Icon name="plus" size={17} />Another repository</button>}</div>}
        {notice && <div className="notice" role="status"><Icon name="info" size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notice"><Icon name="close" size={16} /></button></div>}
        {error && <div className="alert" role="alert"><Icon name="info" size={18} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
        {health && !serviceReady && <div className="notice setup-notice"><Icon name="info" size={18} /><span>{!privateMode && health.dependencies.database !== 'connected' ? 'Connect Neo4j on the server to enable repository evidence.' : 'Configure the answer model on the server to enable explanations.'}</span><button className="text-button" onClick={() => api<Health>(`${workspacePrefix}/health`).then(setHealth).catch(() => setError('Connection check failed.'))}>Check again</button></div>}
        {isWorkspace && !repository && <section className="workspace-dashboard" aria-label="Your saved work"><div className="workspace-dashboard-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Your work</h2></div><button className="text-button" onClick={() => setMobileNav(true)}>View all history <Icon name="arrow" size={15} /></button></div><p>Switch between public and private repositories below. Open a repository to continue exploring.</p><div className="workspace-dashboard-repositories">{repositories.length ? repositories.map(item => <button key={item.repositoryId} onClick={() => chooseRepository(item)}><Icon name="github" size={18} /><span><strong>{item.repository}</strong><small>{item.status === 'complete' ? 'Ready to explore' : item.status === 'partial' ? 'Partially indexed' : item.status === 'running' || item.status === 'queued' ? 'Indexing' : 'Needs attention'}</small></span><Icon name="arrow" size={16} /></button>) : <div className="workspace-dashboard-empty">No {privateMode ? 'private' : 'public'} repositories yet. Connect one below to get started.</div>}</div>{guestImport && (guestImport.repositories > 0 || guestImport.investigations > 0) && <div className="guest-import"><strong>Bring your guest work</strong><p>Copy {guestImport.repositories} repositories and {guestImport.investigations} investigations from this browser into your account.</p><button disabled={importing} onClick={() => void importGuestWork()}>{importing ? 'Importing…' : 'Import guest work'} →</button></div>}{legacyHistory && <div className="guest-import"><strong>Earlier browser history</strong><p>Old history on this device may belong to another person. Import only if it is yours.</p><div className="import-actions"><button disabled={importing} onClick={() => void importBrowserHistory()}>Import history →</button><button disabled={importing} onClick={removeOldBrowserHistory}>Remove old history</button></div></div>}</section>}
        {(!repository || addingRepository) && <section className="connect-card" id="repository-entry" data-reveal aria-label="Connect a repository"><div className="connect-heading"><span className="icon-tile"><Icon name="github" size={22} /></span><div><h2>{repository ? 'Explore another repository' : 'Start with a repository'}</h2><p>{privateMode ? 'Paste a repository selected for your GitHub App.' : isWorkspace ? 'Paste a public GitHub URL to add it to your workspace.' : 'Paste a public GitHub URL. No account needed.'}</p></div><span className="public-badge"><Icon name="shield" size={13} /> READ-ONLY ACCESS</span></div>
        <div className="repository-access" role="group" aria-label="Repository visibility"><button type="button" aria-pressed={!privateMode} onClick={() => setPrivateMode(false)}>Public repository</button><button type="button" aria-pressed={privateMode} onClick={() => { if (account?.user && account.github) setPrivateMode(true); else setAccountOpen(true); }}><Icon name="shield" size={14} />Private repository</button>{privateMode && <span>Session only · Read-only</span>}</div><label className="repo-url-label" htmlFor="repository">GitHub repository URL</label><form className="connect-form" onSubmit={event => void connect(event)}><div className="repo-input"><Icon name="github" size={18} /><input id="repository" inputMode="url" autoCapitalize="none" ref={repoInputRef} value={repositoryInput} onChange={event => setRepositoryInput(event.target.value)} placeholder="github.com/owner/repo" autoComplete="off" spellCheck={false} maxLength={200} required disabled={connecting} /></div><button type="submit" className="primary" disabled={connecting || !repositoryInput.trim()}>{connecting ? 'Connecting…' : 'Explore'}<Icon name="arrow" size={17} /></button></form><details className="history-options"><summary>History options <span>Latest {depth} commits</span><Icon name="chevron" size={13} /></summary><div><label htmlFor="history-depth">Initial history window</label><select id="history-depth" value={depth} onChange={event => setDepth(Number(event.target.value))} disabled={connecting}>{[25,75,200,500].map(value => <option key={value} value={value}>Latest {value} commits</option>)}</select><p>Large repository? Start with a recent window, then load older history in batches. Each workspace supports up to 5,000 commits; file and discussion coverage is bounded separately.</p></div></details>
        {!repository && !privateMode && <div className="try-example"><span>Just looking around?</span><button className="example-button" disabled={connecting} onClick={() => void connect(undefined, 'octocat/Hello-World')}>Try octocat/Hello-World<Icon name="arrow" size={13} /></button><span className="connect-note">Read-only. Always.</span></div>}{repository && <button className="text-button" onClick={() => setAddingRepository(false)}>Cancel</button>}</section>}
        {repository ? <>
          <ol className="workspace-steps" aria-label="Investigation progress"><li className={ready(repository) ? 'done' : 'current'} aria-current={!ready(repository) ? 'step' : undefined}><span>{ready(repository) ? '✓' : '01'}</span><div><strong>Connect sources</strong><small>{working ? 'Indexing repository' : ready(repository) ? 'Ready to explore' : 'Check index status'}</small></div></li><li className={ready(repository) && !answer ? 'current' : answer ? 'done' : ''} aria-current={ready(repository) && !answer ? 'step' : undefined}><span>02</span><div><strong>Ask a question</strong><small>{asking ? 'Following the evidence' : 'Name a file, change, or decision'}</small></div></li><li className={answer ? 'current' : ''} aria-current={answer ? 'step' : undefined}><span>03</span><div><strong>Review the answer</strong><small>Inspect the cited sources</small></div></li></ol>
          <section className="repository-card" data-reveal aria-label="Repository indexing status"><div className="repository-title"><span className="repo-icon"><Icon name="github" size={22} /></span><div><span className="repo-owner">{repository.repository.split('/')[0]} /</span><h2>{repository.repository.split('/')[1]}</h2></div><span className={`status-badge ${repository.status}`}><span className={working ? 'spinner' : 'status-light'} />{working ? 'Indexing' : repository.status === 'complete' ? 'Indexed' : repository.status === 'partial' ? 'Partial index' : 'Interrupted / failed'}</span><button className="icon-button reindex-button" aria-label="Refresh repository index" disabled={Boolean(working) || connecting} onClick={() => void connect(undefined, repository.repository)}><Icon name="refresh" size={17} /></button><SourceLink source={`https://github.com/${repository.repository}`} className="icon-button"><span className="sr-only">Open repository on GitHub</span><Icon name="external" size={16} /></SourceLink></div>
          <button className="workspace-remove-repository" disabled={asking || connecting || Boolean(privateMode && working)} onClick={() => void removeRepository(repository)}>Remove from workspace</button>
          {working && <div className="index-progress" role="status"><div><span>{repository.progress.phase}</span><span>{Math.round(repository.progress.completed / Math.max(1, repository.progress.total) * 100)}%</span></div><progress max={repository.progress.total} value={repository.progress.completed} /></div>}{pollError && <p className="inline-warning" role="status">{pollError}</p>}{repository.errors.map(message => <p className="inline-warning" role="alert" key={message}>{message}</p>)}<details className="repo-index-details"><summary><span>Index details</span><small>{repository.counts.commits.toLocaleString()} commits · {repository.counts.files.toLocaleString()} paths</small><Icon name="chevron" size={14} /></summary><div className="repo-stats">{(['commits', 'files', 'pullRequests', 'issues', 'documents'] as const).map(key => <div key={key}><strong>{repository.counts[key]}</strong><span>{key === 'pullRequests' ? 'pull requests' : key}</span></div>)}<div className="index-date"><Icon name="clock" size={14} /><span>{repository.lastSuccessfulIndexAt ? `Indexed ${date(repository.lastSuccessfulIndexAt)}` : 'Building your evidence index'}</span></div></div>
          {ready(repository) && <div className="history-coverage"><div><strong>History coverage</strong><span>{repository.history?.oldestAt ? `${date(repository.history.oldestAt)} – ${date(repository.history.newestAt)}` : 'Refresh this index to enable older-history loading.'}{repository.history && !repository.history.hasMore ? ' · End of history reached' : ''}</span></div>{repository.history?.hasMore && repository.history.offset < 5000 && <button className="secondary" disabled={connecting || Boolean(working)} onClick={() => void connect(undefined, repository.repository, true)}>Load older history<Icon name="plus" size={14} /></button>}{repository.history?.hasMore && repository.history.offset >= 5000 && <span>5,000-commit safety limit reached</span>}</div>}<details className="coverage-details"><summary><Icon name="info" size={14} />Index coverage & limitations<Icon name="chevron" size={13} /></summary><div>{repository.coverage && <p>{repository.coverage.indexedFiles} of {repository.coverage.totalFiles} repository files read · pinned to <code>{repository.coverage.revision.slice(0, 10)}</code></p>}{repository.warnings.map(message => <p key={message}>{message}</p>)}</div></details></details></section>
          <section className="question-section" data-reveal aria-label="Ask the repository"><div className="section-heading"><h2>Ask your codebase.</h2><span></span></div><form className={`question-composer ${asking ? 'is-busy' : ''}`} onSubmit={ask}><label className="sr-only" htmlFor="question">Ask about this repository</label><textarea id="question" ref={questionRef} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void ask(); } }} maxLength={500} rows={2} placeholder={ready(repository) ? 'Ask about a file, function, change, or decision…' : 'Your repository’s story is being connected…'} disabled={!ready(repository) || asking} required /><div className="composer-toolbar"><details className="answer-options"><summary>Answer options<Icon name="chevron" size={12} /></summary><div className="composer-options"><label><Icon name="book" size={14} /><span className="sr-only">Answer language</span><select aria-label="Answer language" value={language} onChange={event => setLanguage(event.target.value)} disabled={asking}><option value="en">English</option><option value="hi" disabled={privateMode || health?.dependencies.translation !== 'configured'}>Hindi</option><option value="hinglish" disabled={privateMode || health?.dependencies.translation !== 'configured'}>Hinglish</option></select></label><span className="toolbar-divider" /><label className="web-context-toggle"><input type="checkbox" checked={webContext} onChange={event => setWebContext(event.target.checked)} disabled={privateMode || asking || health?.dependencies.externalSearch !== 'configured'} />Web context<Icon name="info" size={13} /></label></div></details><div className="ask-action"><span className="keyboard-hint">Ctrl ↵</span><button className="primary" disabled={!ready(repository) || asking || !question.trim() || !serviceReady || (privateMode && !privateConsent)}>{asking ? <><span className="spinner" />Investigating</> : <>Find the answer<Icon name="arrow" size={17} /></>}</button></div></div></form>{privateMode && <label className="private-consent"><input type="checkbox" checked={privateConsent} onChange={event => setPrivateConsent(event.target.checked)} />Allow my question and relevant private excerpts to be sent to the answer model, and allow the answer and cited excerpts to be saved to my account. Web search and translation are disabled.</label>}{!answer && !asking && <div className="question-suggestions">{suggestions.map(item => <button key={item.label} disabled={!ready(repository)} onClick={() => { setQuestion(item.text); questionRef.current?.focus(); }}><Icon name={item.icon} size={17} /><span>{item.label}</span><Icon name="arrow" size={14} /></button>)}</div>}</section>
          {asking && <section className="loading-investigation" role="status" aria-live="polite"><span className="loading-orbit"><Icon name="branch" size={26} /></span><div><h3>Following the trail.</h3><p>Retrieving sources and independently reviewing the explanation.</p><small>{elapsed}s elapsed · Thorough investigations may take a few minutes.</small></div><div className="skeleton-lines"><span /><span /><span /></div></section>}
          {answer && !asking && <section className="investigation" key={answer.answeredAt} data-reveal ref={answerRef} tabIndex={-1} aria-label="Investigation result"><div className="investigation-topline"><span><Icon name="layers" size={17} />INVESTIGATION</span><time dateTime={answer.answeredAt}>{date(answer.answeredAt)}</time></div><p className="investigation-question">{answer.question}</p><div className={`investigation-layout ${inspectorOpen ? 'with-inspector' : ''}`}><div className="investigation-main"><div className="result-tabs" role="tablist" aria-label="Investigation views">{(['answer', 'evidence', 'timeline', 'graph'] as Tab[]).map((name, index) => <button id={`tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`panel-${name}`} tabIndex={tab === name ? 0 : -1} key={name} onClick={() => selectTab(name)} onKeyDown={event => tabKeys(event, index)}><Icon name={name === 'answer' ? 'search' : name === 'evidence' ? 'file' : name === 'timeline' ? 'clock' : 'branch'} size={16} />{name === 'graph' ? 'Connections' : name[0].toUpperCase() + name.slice(1)}{name === 'evidence' && <span>{answer.evidence.length}</span>}</button>)}</div><div role="tabpanel" key={tab} id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="result-panel" onClick={event => {
              const citation = (event.target as Element).closest('a[data-source-id]');
              if (citation) { event.preventDefault(); inspectSource(citation.getAttribute('data-source-id')); }
            }}>
            {tab === 'answer' && <AnswerView answer={answer} copied={copied} onCopy={async () => { try { await navigator.clipboard.writeText(answer.answer ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setNotice('Copy is unavailable in this browser. You can select the answer text.'); } }} inspectSource={inspectSource} />}
            {tab === 'evidence' && <EvidenceView answer={answer} inspectedId={source?.id} onInspect={inspectSource} />}
            {tab === 'timeline' && <TimelineView timeline={answer.decisionTimeline} />}
            {tab === 'graph' && <Suspense fallback={<p role="status">Opening connections…</p>}><ConnectionsView graph={graph} busy={graphBusy} error={graphError} onRetry={() => void loadGraph()} /></Suspense>}
          </div>{answer.evidence.length > 0 && tab === 'answer' && <div className="answer-source-footer"><span><Icon name="file" size={15} />{answer.citedEvidenceIds.length} cited sources · {answer.evidence.length} retrieved</span><button onClick={() => selectTab('evidence')}>Explore the evidence<Icon name="arrow" size={14} /></button></div>}</div>
          {inspectorOpen && <SourceInspector evidence={answer.evidence} source={source} onInspect={inspectSource} onClose={() => setInspectorOpen(false)} />}</div>{answer.warnings.length > 0 && <details className="result-notes"><summary><Icon name="info" size={14} />Investigation notes ({answer.warnings.length})</summary>{answer.warnings.map(message => <p key={message}>{message}</p>)}</details>}</section>}
          {!answer && !asking && ready(repository) && <div className="ready-state"><span className="ready-line" /><Icon name="branch" size={22} /><p>The index is ready. <strong>Pull on a thread.</strong></p><span className="ready-line" /></div>}
        </> : null}
        {!repository && !isWorkspace && <HomeStory motion={motion} onStart={() => { document.getElementById('repository-entry')?.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'center' }); repoInputRef.current?.focus({ preventScroll: true }); }} />}
        <SiteFooter onHome={returnHome} onHelp={() => navigate('/help')} onRepositories={() => setMobileNav(true)} serviceReady={serviceReady} privateMode={privateMode} />
      </main>
    </div>
  </div>;
}
