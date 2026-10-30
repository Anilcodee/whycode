import neo4j, { Driver, Session } from 'neo4j-driver';
import { Neo4jConfig } from '../../config.js';

// Wraps one shared driver so the graph store, graph reader, and health checks reuse one pool.
export class Neo4jConnection {
  private readonly driver: Driver;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
      connectionTimeout: 10_000,
      connectionAcquisitionTimeout: 10_000,
      maxTransactionRetryTime: 10_000,
      maxConnectionPoolSize: 10,
    });
    this.database = config.database;
  }

  // Target database, defaulting to the server default when not configured.
  readonly database?: string;

  // Confirms the database accepts connections so health checks can report real availability.
  async verifyConnectivity(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  // Opens a session for one unit of graph work.
  session(): Session {
    return this.driver.session({ database: this.database });
  }

  // Closes the driver so the process can shut down without leaving sockets open.
  async close(): Promise<void> {
    await this.driver.close();
  }
}

// Converts driver values such as 64-bit integers into plain JavaScript values.
export function toJsValue(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return value;
}

// Reads a string property from a record, returning undefined for absent values.
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Reads a numeric property from a record, returning undefined for absent values.
export function asNumber(value: unknown): number | undefined {
  const converted = toJsValue(value);
  return typeof converted === 'number' ? converted : undefined;
}
