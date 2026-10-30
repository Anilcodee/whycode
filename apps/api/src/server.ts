import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { Neo4jConnection } from './infrastructure/graph/neo4j-connection.js';
import { Neo4jGraphStore } from './infrastructure/graph/neo4j-graph-store.js';
import { Neo4jGraphReader } from './infrastructure/graph/neo4j-graph-reader.js';
import { GeminiAnswerProvider } from './infrastructure/llm/gemini-answer-provider.js';
import { SarvamTranslator } from './infrastructure/sarvam/sarvam-translator.js';
import { SerpApiClient } from './infrastructure/search/serpapi-client.js';
import { IndexingService } from './services/indexing-service.js';
import { createPostgresPool } from './infrastructure/postgres.js';
import { PostgresAnswerBudget } from './infrastructure/answer-budget.js';
import { SharedAuthFlows } from './infrastructure/shared-auth-flows.js';
import { SharedSessions } from './infrastructure/shared-sessions.js';
import { SessionVault } from './infrastructure/session-vault.js';
import type { AccountSession } from './services/account-service.js';
import { SharedGuestWorkspaces } from './infrastructure/shared-guest-workspaces.js';
import { CentralIndexStore } from './infrastructure/indexing/central-index-store.js';
import { FileIndexingStore } from './infrastructure/indexing/file-indexing-store.js';

const config = loadConfig();
const postgres = config.postgres ? createPostgresPool(config.postgres.url, config.postgres.caFile) : undefined;
const budget = postgres && config.postgres ? new PostgresAnswerBudget(postgres, config.postgres.namespace) : undefined;
const authFlows = postgres && config.postgres && config.sessionStorage
  ? new SharedAuthFlows(postgres, config.postgres.namespace, config.sessionStorage.key) : undefined;
const sessions = postgres && config.postgres && config.sessionStorage
  ? new SharedSessions(postgres, config.postgres.namespace, config.sessionStorage.key) : undefined;
if (sessions && config.sessionStorage) await sessions.importLegacy(new SessionVault<AccountSession>(config.sessionStorage.directory, config.sessionStorage.key).load());
const publicIndexes=postgres && config.postgres ? new CentralIndexStore(postgres,config.postgres.namespace) : undefined;
if(publicIndexes && config.dataDirectory) await publicIndexes.importLegacy(new FileIndexingStore(config.dataDirectory));

// Graph storage and retrieval share one driver; optional providers are selected by configuration.
const neo4j = config.neo4j ? new Neo4jConnection(config.neo4j) : undefined;
const answerProvider = config.answerProvider?.provider === 'gemini'
  ? new GeminiAnswerProvider(config.answerProvider.apiKey, config.answerProvider.model, config.answerProvider.fallbackModel)
  : undefined;
const app = createApp(config, {
  store: publicIndexes,
  authFlows,
  sessions,
  privateIndexes: postgres && config.postgres && config.sessionStorage ? scope => new CentralIndexStore(postgres,config.postgres!.namespace,{...scope,key:config.sessionStorage!.key}) : undefined,
  guestWorkspaces: postgres && config.postgres && config.sessionStorage ? new SharedGuestWorkspaces(postgres, config.postgres.namespace, config.sessionStorage.key) : undefined,
  reserveAnswer: budget ? () => budget.reserve(config.dailyAnswerLimit ?? 100) : undefined,
  neo4j,
  graph: neo4j ? new Neo4jGraphStore(neo4j) : undefined,
  reader: neo4j ? new Neo4jGraphReader(neo4j) : undefined,
  answerProvider,
  translator: config.languageProvider ? new SarvamTranslator(config.languageProvider.apiKey, config.languageProvider.model) : undefined,
  externalSearch: config.externalSearch ? new SerpApiClient(config.externalSearch.apiKey) : undefined,
});

const server = app.listen(config.port, config.host ?? '127.0.0.1', () => {
  console.log(`WhyCode API listening on http://localhost:${config.port}`);
  console.log(neo4j ? 'Neo4j graph storage: configured' : 'Neo4j graph storage: not configured (memory store)');
  console.log(answerProvider ? `Answer provider: ${config.answerProvider?.provider}/${answerProvider.model}` : 'Answer provider: not configured');
  console.log(config.languageProvider ? `Language output: ${config.languageProvider.model}` : 'Language output: not configured (English only)');
  console.log(config.externalSearch ? 'External web context: configured (secondary lane only)' : 'External web context: disabled');
});

// Bound slow uploads and idle sockets without truncating long answer generation.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.maxRequestsPerSocket = 100;

// Releases driver resources so the process exits cleanly on shutdown signals.
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  IndexingService.stopRecovery();
  console.log('Shutting down: waiting for active requests and indexing jobs.');
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  const timeout = setTimeout(() => {
    console.error('Shutdown timed out; interrupted public indexes will be marked for retry on restart.');
    process.exit(1);
  }, 30_000);
  timeout.unref();
  try {
    await closed;
    await IndexingService.waitForActiveJobs();
    await neo4j?.close();
    await postgres?.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch {
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
