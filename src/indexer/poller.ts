import { Server } from "@stellar/stellar-sdk/rpc";
import { scValToNative } from "@stellar/stellar-sdk";
import {
  getLastIndexedLedger,
  insertEventBatch,
  getActiveContractIds,
  registerContract,
  type EventRow,
} from "./db.js";
import { deliverWebhooks } from "./webhook-delivery.js";
import logger from "../utils/logger.js";

const RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const server = new Server(RPC_URL);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "15000", 10);

/**
 * Resolve an RPC event's close time to epoch seconds.
 *
 * Missing or unparseable `ledgerClosedAt` yields `null` (stored as NULL by
 * migration v3) — never the wall-clock time, so backfills can't stamp old
 * events with today's date, and invalid strings can't become NaN (#708).
 */
export function toEventTimestamp(ledgerClosedAt: unknown): number | null {
  if (typeof ledgerClosedAt !== "string" || ledgerClosedAt.trim() === "") {
    logger.warn("Indexer event missing ledgerClosedAt – storing NULL timestamp");
    return null;
  }
  const millis = new Date(ledgerClosedAt).getTime();
  if (!Number.isFinite(millis)) {
    logger.warn("Indexer event has invalid ledgerClosedAt – storing NULL timestamp", {
      ledgerClosedAt,
    });
    return null;
  }
  return Math.floor(millis / 1000);
}

const EVENT_TYPES = [
  "initialized",
  "funded",
  "delivered",
  "approved",
  "dispute_raised",
  "dispute_resolved",
  "partial_release",
  "auto_release_claimed",
  "token_whitelisted",
  "token_removed",
];

/**
 * Poll events for all active contract IDs stored in monitored_contracts (#85).
 * All events fetched in a single poll are written atomically together with the
 * ledger pointer update (#84) – so a mid-poll crash cannot advance the pointer
 * without committing the accompanying events.
 */
export async function pollEvents() {
  // --- Resolve active contract IDs from the DB (#85) ---
  let contractIds: string[] = getActiveContractIds();

  // Fall back to the legacy single CONTRACT_ID env var so existing deployments
  // keep working without any DB seed step.
  if (contractIds.length === 0 && process.env.CONTRACT_ID) {
    registerContract(process.env.CONTRACT_ID, "default");
    contractIds = [process.env.CONTRACT_ID];
  }

  if (contractIds.length === 0) {
    logger.debug("No CONTRACT_IDs configured – skipping indexer poll");
    return;
  }

  try {
    const lastLedger = getLastIndexedLedger();
    const currentLedger = (await server.getLatestLedger()).sequence;
    if (currentLedger <= lastLedger) return;

    const startLedger = lastLedger + 1;

    logger.info("Polling events", { startLedger, currentLedger });

    const events = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds,
          topics: [[...EVENT_TYPES]],
        },
      ],
      limit: 100,
    });

    // Build the batch to be written atomically (#84)
    const batch: EventRow[] = events.events.map((event) => ({
      contractId: event.contractId?.contractId() ?? contractIds[0],
      eventType: scValToNative(event.topic[0]) as string,
      ledgerSequence: event.ledger,
      timestamp: toEventTimestamp(event.ledgerClosedAt),
      dataJson: JSON.stringify(event.value),
    }));

    // Persist the batch and advance the ledger pointer atomically (#84)
    insertEventBatch(batch, currentLedger);
    logger.info("Processed indexer poll", {
      eventCount: events.events.length,
      upToLedger: currentLedger,
    });

    deliverWebhooks(startLedger, currentLedger).catch((err) =>
      logger.error("Error delivering webhooks", {
        error: err instanceof Error ? err.message : String(err),
      })
    );
  } catch (err) {
    logger.error("Error polling events", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let pollerInterval: NodeJS.Timeout | null = null;

export function startPoller() {
  if (pollerInterval) return;
  logger.info("Starting event indexer poller", { intervalMs: POLL_INTERVAL_MS });
  pollEvents();
  pollerInterval = setInterval(pollEvents, POLL_INTERVAL_MS);
}

export function stopPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}
