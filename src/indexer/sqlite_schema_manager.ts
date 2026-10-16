import logger from "../utils/logger.js";
import { FailureMonitor } from "./failure-monitor.js";

/**
 * sqlite_schema_manager failure / stall alerting (#262).
 *
 * Tracks consecutive schema init/migration failures and emits threshold
 * warnings when operations stall or fail repeatedly.
 *
 * Backed by the shared `FailureMonitor` implementation in
 * `./failure-monitor.ts` (#722).
 */

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_STALL_THRESHOLD_MS = 120_000;

export type SqliteSchemaManagerFailureType =
  | "migration"
  | "bootstrap"
  | "stall";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export class SqliteSchemaManagerFailureMonitor extends FailureMonitor {
  constructor(
    options: {
      name?: string;
      failureThreshold?: number;
      stallThresholdMs?: number;
    } = {},
  ) {
    super({
      name: options.name ?? "sqlite_schema_manager",
      logComponent: "sqlite_schema_manager",
      payloadKey: "manager",
      failureThreshold:
        options.failureThreshold ??
        readPositiveIntEnv(
          "SQLITE_SCHEMA_MANAGER_FAILURE_THRESHOLD",
          DEFAULT_FAILURE_THRESHOLD,
        ),
      stallThresholdMs:
        options.stallThresholdMs ??
        readPositiveIntEnv(
          "SQLITE_SCHEMA_MANAGER_STALL_THRESHOLD_MS",
          DEFAULT_STALL_THRESHOLD_MS,
        ),
      onError: (_failureType, payload) => {
        logger.error("sqlite_schema_manager operation failed", payload);
      },
      onAlert: (payload) => {
        logger.warn(
          "sqlite_schema_manager alert: consecutive failure threshold reached",
          {
            ...payload,
            action:
              "Inspect SQLite migration SQL and disk permissions; the manager resumes automatically after the next successful runMigrations().",
          },
        );
      },
      onRecovery: (hadFailures) => {
        if (hadFailures) {
          logger.info(
            "sqlite_schema_manager recovered after consecutive failures",
            { manager: this.name },
          );
        }
      },
      onStall: (info) => {
        const stallThresholdMs = readPositiveIntEnv(
          "SQLITE_SCHEMA_MANAGER_STALL_THRESHOLD_MS",
          this.stallThresholdMs,
        );
        logger.warn("sqlite_schema_manager alert: stall threshold reached", {
          ...info,
          stallThresholdMs,
          action:
            "No successful sqlite_schema_manager operation within the stall window; inspect migration health.",
        });
      },
    });
  }
}

const defaultMonitor = new SqliteSchemaManagerFailureMonitor();

export function getSqliteSchemaManagerFailureMonitor(): SqliteSchemaManagerFailureMonitor {
  return defaultMonitor;
}

export function resetSqliteSchemaManagerFailureState(): void {
  defaultMonitor.reset();
}
