import { randomUUID } from 'node:crypto';
import {
  DEFAULT_INDEX_LIMITS,
  GraphWriteReport,
  IndexLimits,
  IndexProgress,
  IndexStatus,
  IndexedSnapshot,
} from '../domain/indexing.js';
import { GitHubApiError, GitHubClient } from '../infrastructure/github/github-client.js';
import { GraphStore } from '../infrastructure/graph/graph-store.js';
import { IndexingStore } from '../infrastructure/indexing/indexing-store.js';
import { repositoryIdFor } from '../utils/repository.js';

// Coordinates bounded GitHub ingestion, graph storage, and progress reporting.
export class IndexingService {
  private static active = 0;
  private static starting = 0;
  private readonly starts = new Map<string,Promise<IndexStatus>>();
  private recoveryPending=false;
  private static readonly activeJobs = new Set<Promise<void>>();
  private static readonly recoveryWorkers = new Set<Promise<void>>();
  private static readonly recoveryTimers = new Set<ReturnType<typeof setInterval>>();
  static stopRecovery() { for(const timer of this.recoveryTimers)clearInterval(timer); this.recoveryTimers.clear(); }

  /** Wait for indexing started by this process, including private workspaces. */
  static async waitForActiveJobs(): Promise<void> {
    while (this.activeJobs.size || this.recoveryWorkers.size) {
      await Promise.allSettled([...this.activeJobs, ...this.recoveryWorkers]);
    }
  }
  constructor(
    private readonly github: GitHubClient,
    private readonly store: IndexingStore,
    private readonly graph?: GraphStore,
    private readonly authorizeRecovery?:(repository:string)=>Promise<void>,
  ) {
    if(store.recoverableJobs&&store.recoveryEnabled!==false) {
      let busy=false;
      const sweep=()=> {
        if(busy)return;
        busy=true;
        const worker=this.recoverCentral().finally(()=>{busy=false;});
        IndexingService.recoveryWorkers.add(worker);
        void worker.then(()=>IndexingService.recoveryWorkers.delete(worker),()=>{IndexingService.recoveryWorkers.delete(worker);console.error('Central recovery is temporarily unavailable.');});
      };
      const timer=setInterval(sweep,5000);timer.unref();IndexingService.recoveryTimers.add(timer);sweep();
    }
    if (store.recoverJobs) {
      const worker = this.recover();
      IndexingService.recoveryWorkers.add(worker);
      void worker.then(() => IndexingService.recoveryWorkers.delete(worker), () => {
        IndexingService.recoveryWorkers.delete(worker);
        console.error('Index recovery could not persist its status.');
      });
    }
  }
  requestRecovery() {
    if(!this.store.recoverableJobs||this.recoveryPending)return;
    this.recoveryPending=true;
    const worker=this.recoverCentral().finally(()=>{this.recoveryPending=false;});
    IndexingService.recoveryWorkers.add(worker);
    void worker.then(()=>IndexingService.recoveryWorkers.delete(worker),()=>{IndexingService.recoveryWorkers.delete(worker);console.error('Authenticated index recovery is temporarily unavailable.');});
  }
  private async recoverCentral() {
    for(const old of await this.store.recoverableJobs!()) {
      if(this.authorizeRecovery) { try {await this.authorizeRecovery(old.repository);} catch {continue;} }
      if(IndexingService.active+IndexingService.starting>=2)return;
      const recovered={...old,jobId:randomUUID(),status:'queued' as const,errors:[],request:old.request?{...old.request,recoveries:old.request.recoveries+1}:undefined};
      if(!await this.store.claimJob!(recovered,old.jobId))continue;
      if(!old.request||old.request.recoveries>=3) {
        await this.store.saveStatus({...recovered,status:'failed',errors:['Automatic recovery limit reached. Refresh to retry.']});continue;
      }
      const snapshot=await this.store.getSnapshot(old.repositoryId);
      if(snapshot && old.startedAt && snapshot.indexedAt>=old.startedAt) {
        const worker=this.finishRecoveredSnapshot(recovered,snapshot);
        IndexingService.activeJobs.add(worker);
        try { await worker; } finally { IndexingService.activeJobs.delete(worker); }
        continue;
      }
      const previous=old.request.append?snapshot:undefined;
      if(old.request.append&&(!previous||previous.indexedAt!==old.request.baseIndexedAt)) {
        await this.store.saveStatus({...recovered,status:'partial',errors:['Continuation changed. Refresh this repository.']});continue;
      }
      await this.execute(recovered,old.request.limits,previous);
    }
  }
  private async finishRecoveredSnapshot(status:IndexStatus,snapshot:IndexedSnapshot) {
    const graph=await this.writeToGraph(snapshot,status.generation);
    await this.store.saveStatus({...status,status:graph.status==='failed'?'partial':'complete',graph,counts:snapshot.counts,history:snapshot.history,coverage:snapshot.coverage,lastSuccessfulIndexAt:snapshot.indexedAt,completedAt:new Date().toISOString(),progress:{phase:'Recovery complete',completed:6,total:6}});
  }

  private async recover(): Promise<void> {
    for (const status of await this.store.listStatuses()) {
      if (status.status !== 'queued' || !status.request) continue;
      while (IndexingService.active >= 2) await new Promise(resolve => setTimeout(resolve, 100));
      const previous = status.request.append ? await this.store.getSnapshot(status.repositoryId) : undefined;
      if (status.request.append && (!previous || previous.indexedAt !== status.request.baseIndexedAt)) {
        await this.store.saveStatus({ ...status, status: 'partial', errors: ['The snapshot changed before recovery. Refresh the index before loading more history.'], completedAt: new Date().toISOString() });
        continue;
      }
      const recovered = { ...status, request: { ...status.request, recoveries: status.request.recoveries + 1 } };
      await this.store.saveStatus(recovered);
      await this.execute(recovered, recovered.request.limits, previous);
    }
  }

  // Creates a queued job and starts indexing without blocking the HTTP response.
  start(repository: string, limits: IndexLimits = DEFAULT_INDEX_LIMITS, append = false): Promise<IndexStatus> {
    const pending=this.starts.get(repository);
    if(pending)return pending;
    const operation=this.startOperation(repository,limits,append).finally(()=>this.starts.delete(repository));
    this.starts.set(repository,operation);
    return operation;
  }
  private async startOperation(repository: string, limits: IndexLimits, append: boolean): Promise<IndexStatus> {
    const repositoryId = repositoryIdFor(repository);
    const existing = await this.store.getStatus(repositoryId);
    const previous = append ? await this.store.getSnapshot(repositoryId) : undefined;

    if (existing?.status === 'queued' || existing?.status === 'running') {
      return existing;
    }
    if (append && (!previous?.history?.hasMore || previous.history.offset >= 5000)) throw new Error('HISTORY_LIMIT');

    if (IndexingService.active + IndexingService.starting >= 2) {
      throw new Error('INDEX_BUSY');
    }
    IndexingService.starting++;
    try {
    if (!existing && (await this.store.listStatuses()).length >= 30) throw new Error('WORKSPACE_FULL');
    const status = { ...this.createStatus(repository, limits), lastSuccessfulIndexAt: existing?.lastSuccessfulIndexAt,
      request: { limits: { ...limits }, append, baseIndexedAt: previous?.indexedAt, recoveries: 0 } };
    if (this.store.claimJob) {
      if (!await this.store.claimJob(status)) {
        const current=await this.store.getStatus(repositoryId);
        if(!current||!['queued','running'].includes(current.status))throw new Error('INDEX_BUSY');
        return current;
      }
    } else await this.store.saveStatus(status);
    void this.execute(status, limits, previous);
    return status;
    } finally { IndexingService.starting--; }
  }

  private execute(status: IndexStatus, limits: IndexLimits, previous?: IndexedSnapshot): Promise<void> {
    IndexingService.active++;
    const heartbeat = this.store.renewJob ? setInterval(() => { void this.store.renewJob!(status.repositoryId, status.jobId).catch(() => console.error('Index lease renewal failed.')); }, 30000) : undefined;
    const job = this.run(status, limits, previous).finally(() => { if (heartbeat) clearInterval(heartbeat); });
    IndexingService.activeJobs.add(job);
    void job.then(
      () => { IndexingService.active--; IndexingService.activeJobs.delete(job); },
      () => { IndexingService.active--; IndexingService.activeJobs.delete(job); console.error('Indexing job could not persist its final status.'); },
    );
    return job;
  }

  async listStatuses(): Promise<IndexStatus[]> { return this.store.listStatuses(); }

  // Returns the latest status while keeping storage details behind the service boundary.
  async getStatus(repositoryId: string): Promise<IndexStatus | undefined> {
    return this.store.getStatus(repositoryId);
  }

  // Runs each source collection in a predictable sequence for transparent progress reporting.
  private async run(initialStatus: IndexStatus, limits: IndexLimits, previous?: IndexedSnapshot): Promise<void> {
    const repositoryId = initialStatus.repositoryId;
    let status = await this.updateStatus(initialStatus, {
      status: 'running',
      progress: { phase: 'Checking repository', completed: 0, total: 6 },
    });

    try {
      const repositoryInfo = await this.github.getRepository(initialStatus.repository);
      status = await this.updateStatus(status, { progress: { phase: 'Fetching commits', completed: 1, total: 6 } });
      const window = await this.github.listCommitWindow(initialStatus.repository, Math.min(limits.commits, 5000 - (previous?.history?.offset ?? 0)), previous?.history);
      const commits = uniqueBy([...(previous?.commits ?? []), ...window.commits], item => item.sha);
      const history = { ...window.history, newestAt: previous?.history?.newestAt ?? window.history.newestAt };

      status = await this.updateStatus(status, { progress: { phase: 'Fetching changed files', completed: 2, total: 6 } });
      const fileResult = await this.github.listChangedFiles(initialStatus.repository, window.commits);
      const files = fileResult.files;
      const commitFiles = uniqueBy([...(previous?.commitFiles ?? []), ...fileResult.commitFiles], item => item.sha);

      status = await this.updateStatus(status, { progress: { phase: 'Fetching pull requests', completed: 3, total: 6 } });
      const latestPullRequests = await this.github.listPullRequests(initialStatus.repository, limits.pullRequests);
      const associations = limits.pullRequests > 0 ? await this.github.listCommitAssociations(initialStatus.repository, window.commits) : { pullRequests: [], links: [] };
      const pullRequests = uniqueBy([...(previous?.pullRequests ?? []), ...associations.pullRequests, ...latestPullRequests], pr => pr.number).slice(0, 500);

      status = await this.updateStatus(status, { progress: { phase: 'Fetching issues', completed: 4, total: 6 } });
      const issues = await this.github.listIssues(initialStatus.repository, limits.issues);

      status = await this.updateStatus(status, { progress: { phase: 'Fetching comments', completed: 5, total: 6 } });
      const comments = await this.github.listComments(initialStatus.repository, limits.comments);

      status = await this.updateStatus(status, { progress: { phase: 'Reading code and documents', completed: 5, total: 6 } });
      const sourceResult = previous?.coverage ? { sources: previous.sources ?? [], revision: previous.coverage.revision,
        totalFiles: previous.coverage.totalFiles, truncatedTree: previous.coverage.truncatedTree }
        : await this.github.listSources(initialStatus.repository, history.head || repositoryInfo.default_branch);
      const allFiles = [...new Set([...(previous?.files ?? []), ...files, ...sourceResult.sources.map(source => source.path)])];
      const coverage = { revision: sourceResult.revision, indexedFiles: sourceResult.sources.length, totalFiles: sourceResult.totalFiles,
        truncatedTree: sourceResult.truncatedTree,
        limits: ['Up to 80 text files, 32 KB per file, 500 KB total; changed paths from up to 50 commits.', 'Binary, generated, credential, and oversized files are excluded. Symbol matching is lexical.', 'Direct GitHub commit-to-PR associations cover up to 10 commits (3 without a GitHub token).'] };
      const counts = {
        commits: commits.length,
        files: allFiles.length,
        pullRequests: pullRequests.length,
        issues: issues.length,
        comments: comments.length,
        documents: sourceResult.sources.filter(source => source.kind === 'document').length,
      };
      const indexedAt = new Date().toISOString();
      const snapshot: IndexedSnapshot = {
        repositoryId,
        history,
        repository: initialStatus.repository,
        indexedAt,
        counts,
        commits,
        pullRequests,
        issues,
        comments,
        files: allFiles,
        sources: sourceResult.sources,
        revision: sourceResult.revision,
        coverage,
        commitFiles,
        commitPullRequests: uniqueBy([...(previous?.commitPullRequests ?? []), ...associations.links], item => `${item.sha}:${item.number}`),
        fullName: repositoryInfo.full_name,
        repositoryUrl: repositoryInfo.html_url,
        defaultBranch: repositoryInfo.default_branch,
      };

      await this.store.saveSnapshot(snapshot, status.jobId);
      const graphReport = await this.writeToGraph(snapshot,status.generation);

      status = await this.updateStatus(status, { graph: graphReport });
      await this.store.saveStatus({
        ...status,
        status: graphReport.status === 'failed' ? 'partial' : 'complete',
        coverage,
        history,
        completedAt: indexedAt,
        lastSuccessfulIndexAt: indexedAt,
        counts,
        progress: { phase: 'Indexing complete', completed: 6, total: 6 },
        warnings: [
          `${commits.length} commits indexed from a pinned history window. ${history.hasMore ? 'Older history is available.' : 'End of this default-branch history reached.'}`,
          ...(fileResult.limited ? ['Changed file paths were collected from a bounded subset of commits to protect GitHub rate limits.'] : []),
          ...coverage.limits,
          ...(coverage.truncatedTree ? ['GitHub truncated the tree; indexing covers only the returned paths.'] : []),
          ...graphWarnings(graphReport),
        ],
      });
    } catch (error) {
      const message = error instanceof GitHubApiError
        ? error.message
        : 'Indexing failed while reading GitHub data.';
      await this.store.saveStatus({
        ...status,
        status: previous ? 'partial' : 'failed',
        ...(previous ? { counts: previous.counts, history: previous.history, coverage: previous.coverage } : {}),
        completedAt: new Date().toISOString(),
        errors: [previous ? `${message} Your previously indexed history is still available.` : message],
        progress: { ...status.progress, phase: previous ? 'Older history could not be loaded' : 'Indexing failed' },
      });
    }
  }

  // Creates a consistent initial status object for every indexing job.
  private createStatus(repository: string, limits: IndexLimits): IndexStatus {
    return {
      repositoryId: repositoryIdFor(repository),
      repository,
      jobId: randomUUID(),
      status: 'queued',
      version: 2,
      startedAt: new Date().toISOString(),
      counts: { commits: 0, files: 0, pullRequests: 0, issues: 0, comments: 0, documents: 0 },
      progress: { phase: 'Queued', completed: 0, total: 6 },
      warnings: [`Bounded indexing limits: ${limits.commits} commits, ${limits.pullRequests} pull requests, ${limits.issues} issues, ${limits.comments} comments.`],
      errors: [],
    };
  }

  // Applies a partial status change while preserving fields not involved in the update.
  private async updateStatus(status: IndexStatus, update: Partial<IndexStatus>): Promise<IndexStatus> {
    const nextStatus = { ...status, ...update };
    await this.store.saveStatus(nextStatus);
    return nextStatus;
  }

  // Writes the snapshot to the graph when configured; failures never fail the whole index run.
  private async writeToGraph(snapshot: IndexedSnapshot,generation?:number): Promise<GraphWriteReport> {
    if (!this.graph) {
      return { status: 'skipped' };
    }

    try {
      const summary = await this.graph.saveRepositoryHistory(snapshot,generation);
      return {
        status: 'written',
        nodes: summary.nodesWritten,
        relationships: summary.relationshipsWritten,
      };
    } catch (error) {
      return {
        status: 'failed',
        detail: 'Graph storage is unavailable. Check server configuration and retry.',
      };
    }
  }
}

// Turns the graph write result into user-visible warnings so the interface stays honest.
function graphWarnings(report: GraphWriteReport): string[] {
  if (report.status === 'skipped') {
    return ['The relationship database is not configured.'];
  }

  if (report.status === 'failed') {
    return [`Graph storage failed: ${report.detail ?? 'unknown error'}.`];
  }

  return [`Graph storage: ${report.nodes ?? 0} nodes and ${report.relationships ?? 0} relationships were stored in Neo4j.`];
}

function uniqueBy<T>(items: T[], key: (item: T) => string | number): T[] {
  return [...new Map(items.map(item => [key(item), item])).values()];
}
