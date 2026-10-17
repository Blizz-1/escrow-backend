import { getDb, EventDbRow } from "./db.js";
import logger from "../utils/logger.js";

const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1500, 4500];

/**
 * Page size for the ledger-range scan inside deliverWebhooks (#690).
 * Keeps peak memory bounded even after long downtime when the range is large.
 */
const WEBHOOK_DELIVERY_PAGE_SIZE =
  parseInt(process.env.WEBHOOK_DELIVERY_PAGE_SIZE || "500", 10) || 500;

interface DeliveryResult {
  subscriptionId: number;
  webhookUrl: string;
  eventId: number;
  success: boolean;
  attempts: number;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverToUrl(
  webhookUrl: string,
  event: EventDbRow
): Promise<boolean> {
  const payload = {
    event_type: event.event_type,
    contract_id: event.contract_id,
    ledger_sequence: event.ledger_sequence,
    timestamp: event.timestamp,
    data: JSON.parse(event.data_json),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function deliverEventToSubscriber(
  webhookUrl: string,
  event: EventDbRow,
  subscriptionId: number
): Promise<DeliveryResult> {
  let success = false;
  let lastError: string | undefined;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attemptsMade = attempt;
    success = await deliverToUrl(webhookUrl, event);
    if (success) break;

    lastError = `Attempt ${attempt}/${MAX_RETRIES} failed`;
    logger.warn(`Webhook delivery failed`, {
      webhookUrl,
      eventId: event.id,
      attempt,
    });

    if (attempt < MAX_RETRIES) {
      await sleep(BACKOFF_MS[attempt - 1] || BACKOFF_MS[0]);
    }
  }

  return {
    subscriptionId,
    webhookUrl,
    eventId: event.id,
    success,
    attempts: attemptsMade,
    error: success ? undefined : lastError,
  };
}

function subscriptionsMatchEvent(
  eventTypes: string,
  eventType: string
): boolean {
  if (eventTypes === "*") return true;
  try {
    const types = JSON.parse(eventTypes) as string[];
    return types.includes(eventType);
  } catch {
    return eventTypes === eventType;
  }
}

export async function deliverWebhooks(
  startLedger: number,
  endLedger: number
): Promise<DeliveryResult[]> {
  const db = getDb();

  // Fetch only the contract IDs that actually have subscriptions (#690).
  // This lets the SQL engine skip every event for un-subscribed contracts
  // before any rows reach application memory.
  const subscribedContractIds: string[] = (
    db
      .prepare(
        "SELECT DISTINCT contract_id FROM webhook_subscriptions",
      )
      .all() as Array<{ contract_id: string }>
  ).map((r) => r.contract_id);

  if (subscribedContractIds.length === 0) return [];

  const placeholders = subscribedContractIds.map(() => "?").join(", ");

  const results: DeliveryResult[] = [];

  // Page through the range 500 rows at a time (#690).
  // Keeps peak RSS bounded even when the range spans thousands of ledgers.
  let pageStart = startLedger;
  while (pageStart <= endLedger) {
    const pageEnd = Math.min(pageStart + WEBHOOK_DELIVERY_PAGE_SIZE - 1, endLedger);

    // Query only events for subscribed contracts within this page.
    const events = db
      .prepare(
        `SELECT * FROM events
         WHERE ledger_sequence >= ? AND ledger_sequence <= ?
           AND contract_id IN (${placeholders})
         ORDER BY ledger_sequence ASC`,
      )
      .all(pageStart, pageEnd, ...subscribedContractIds) as EventDbRow[];

    for (const event of events) {
      // Fetch the matching subscriptions for this specific contract.
      const subscriptions = db
        .prepare(
          "SELECT * FROM webhook_subscriptions WHERE contract_id = ?",
        )
        .all(event.contract_id) as Array<{
          id: number;
          contract_id: string;
          webhook_url: string;
          event_types: string;
        }>;

      for (const sub of subscriptions) {
        if (!subscriptionsMatchEvent(sub.event_types, event.event_type)) {
          continue;
        }

        const result = await deliverEventToSubscriber(
          sub.webhook_url,
          event,
          sub.id,
        );
        results.push(result);

        if (result.success) {
          logger.info(`Webhook delivered`, {
            subscriptionId: sub.id,
            eventId: event.id,
            webhookUrl: sub.webhook_url,
          });
        } else {
          logger.error(`Webhook delivery failed after ${MAX_RETRIES} attempts`, {
            subscriptionId: sub.id,
            eventId: event.id,
            webhookUrl: sub.webhook_url,
          });
        }
      }
    }

    pageStart = pageEnd + 1;
  }

  return results;
}
