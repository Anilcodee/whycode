import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { SharedLimitConfig } from './infrastructure/shared-rate-limit.js';

// Workspace scripts run with the package directory as the working directory,
// so the repository-root .env is loaded explicitly as a fallback.
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

// Defines the runtime configuration used by the API and its integrations.
export interface AppConfig {
  port: number;
  host?: string;
  production?: boolean;
  trustProxy?: boolean;
  publicOrigin?: string;
  dataDirectory?: string;
  dailyAnswerLimit?: number;
  sessionStorage?: { directory: string; key: string };
  sharedRateLimits?: SharedLimitConfig;
  postgres?: { url: string; caFile: string; namespace: string };
  clientOrigin: string;
  githubApiUrl: string;
  githubToken?: string;
  accounts?: { url: string; key: string; providers: string[] };
  githubApp?: { clientId: string; clientSecret: string; slug: string };
  neo4j?: Neo4jConfig;
  answerProvider?: AnswerProviderConfig;
  languageProvider?: LanguageProviderConfig;
  externalSearch?: ExternalSearchConfig;
}

// Describes the connection used for the graph repository when Neo4j is configured.
export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

// Describes the server-side model that turns retrieved evidence into answers.
export interface AnswerProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  fallbackModel?: string;
}

// Describes the optional Hindi/Hinglish output layer.
export interface LanguageProviderConfig {
  apiKey: string;
  model: string;
}

// Describes the optional external web-context search used only as a secondary lane.
export interface ExternalSearchConfig {
  apiKey: string;
}

// Reads environment variables once so the rest of the application receives typed configuration.
export function loadConfig(): AppConfig {
  const production = process.env.NODE_ENV === 'production';
  const publicOrigin = process.env.PUBLIC_ORIGIN || undefined;
  if (production && !publicOrigin?.startsWith('https://')) {
    throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
  }
  return {
    production, publicOrigin,
    sharedRateLimits: readSharedRateLimits(),
    postgres: readPostgres(),
    sessionStorage: process.env.SESSION_ENCRYPTION_KEY ? {
      directory: resolve(process.env.DATA_DIRECTORY || fileURLToPath(new URL('../../../.whycode', import.meta.url))),
      key: process.env.SESSION_ENCRYPTION_KEY,
    } : undefined,
    trustProxy: process.env.TRUST_PROXY === '1',
    host: production ? '0.0.0.0' : '127.0.0.1',
    dataDirectory: resolve(process.env.DATA_DIRECTORY || fileURLToPath(new URL('../../../.whycode', import.meta.url))),
    dailyAnswerLimit: Math.max(1, Math.min(1000, Number(process.env.DAILY_ANSWER_LIMIT) || 100)),
    port: readPort(process.env.PORT),
    clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    githubApiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    githubToken: process.env.GITHUB_TOKEN || undefined,
    accounts: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? {
      url: new URL(process.env.SUPABASE_URL).origin,
      key: process.env.SUPABASE_ANON_KEY,
      providers: (process.env.ACCOUNT_PROVIDERS ?? 'email,google,github').split(',').filter(value => ['email', 'google', 'github'].includes(value)),
    } : undefined,
    githubApp: process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_SLUG ? {
      clientId: process.env.GITHUB_APP_CLIENT_ID, clientSecret: process.env.GITHUB_APP_CLIENT_SECRET, slug: process.env.GITHUB_APP_SLUG,
    } : undefined,
    neo4j: readNeo4jConfig(),
    answerProvider: readAnswerProviderConfig(),
    languageProvider: readLanguageProviderConfig(),
    externalSearch: readExternalSearchConfig(),
  };
}

function readPostgres(): AppConfig['postgres'] {
  const url = process.env.DATABASE_URL, caFile = process.env.DATABASE_SSL_CA_FILE;
  if (!url && !caFile) return undefined;
  if (!url || !caFile) throw new Error('Configure both DATABASE_URL and DATABASE_SSL_CA_FILE for shared usage tracking.');
  return { url, caFile, namespace: process.env.RATE_LIMIT_NAMESPACE || `whycode-${process.env.NODE_ENV || 'development'}` };
}

function readSharedRateLimits(): SharedLimitConfig | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return undefined;
  if (!url || !token) throw new Error('Configure both Redis REST URL and token for shared rate limits.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Redis REST URL must be an HTTPS endpoint without credentials or query parameters.');
  const namespace = process.env.RATE_LIMIT_NAMESPACE || `whycode-${process.env.NODE_ENV || 'development'}`;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) throw new Error('RATE_LIMIT_NAMESPACE must contain 1–64 letters, numbers, underscores or hyphens.');
  return { url: endpoint.href, token, namespace };
}

// Treats the language provider as configured only when an API key is present.
function readLanguageProviderConfig(): LanguageProviderConfig | undefined {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    model: process.env.SARVAM_MODEL || 'sarvam-105b',
  };
}

// Treats external web search as configured only when a SerpAPI key is present.
function readExternalSearchConfig(): ExternalSearchConfig | undefined {
  const apiKey = process.env.SERPAPI_API_KEY;
  return apiKey ? { apiKey } : undefined;
}

// Treats the answer provider as configured only when an API key is present.
function readAnswerProviderConfig(): AnswerProviderConfig | undefined {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  return {
    provider: process.env.LLM_PROVIDER || 'gemini',
    apiKey,
    model: process.env.LLM_MODEL || 'gemini-2.0-flash',
    fallbackModel: process.env.LLM_FALLBACK_MODEL || undefined,
  };
}

// Treats Neo4j as configured only when every required connection value is present.
function readNeo4jConfig(): Neo4jConfig | undefined {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    return undefined;
  }

  return {
    uri,
    username,
    password,
    database: process.env.NEO4J_DATABASE || undefined,
  };
}

// Keeps an invalid port from preventing the API from starting with a useful default.
function readPort(value: string | undefined): number {
  const port = Number(value ?? 4000);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 4000;
}
