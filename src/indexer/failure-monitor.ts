export interface FailureMonitorOptions {
  /** Identifies the monitor in alert payloads. */
  name?: string;
  /** Component name used in log messages (defaults to `name`). */
  logComponent?: string;
  /** Payload key used for the component identifier (defaults to "component"). */
  payloadKey?: string;
  /** Consecutive failures required before alerting (default: 3). */
  failureThreshold?: number;
  /** Silence after which a non-failing monitor is considered stalled. */
  stallThresholdMs?: number;
  /** When true, alert fires at >= threshold instead of === threshold. */
  thresholdReachedOrExceeded?: boolean;
  /** When true, uses a stallAlerted latch to avoid repeating stall warnings. */
  trackStallAlerted?: boolean;
  /** When false, skips the recovery notification on recordSuccess. */
  logRecoveryOnSuccess?: boolean;
  /** Called on every recorded failure with the failure payload. */
  onError?: (
    failureType: string,
    payload: Record<string, unknown>,
  ) => void;
  /** Called when the failure threshold is first reached. */
  onAlert?: (payload: Record<string, unknown>) => void;
  /** Called when recovering after failures. */
  onRecovery?: (hadFailures: boolean) => void;
  /** Called when a stall is detected. */
  onStall?: (info: Record<string, unknown>) => void;
}

export interface FailureMonitorFailureDetails {
  error?: string;
  [key: string]: unknown;
}

/**
 * Tracks consecutive failures for a component and raises alerts when thresholds
 * are crossed. This is the single implementation shared by all indexer
 * components that previously each had their own copy-pasted monitor class.
 *
 * Core state (consecutiveFailures, lastSuccessfulAt, alertActive, stallAlerted)
 * and the recordFailure / recordSuccess / checkStall / reset logic live here.
 * Logging is delegated to caller-supplied callbacks so the monitor itself has
 * no direct dependency on a logger implementation.
 */
export class FailureMonitor {
  readonly name: string;
  readonly logComponent: string;
  readonly payloadKey: string;
  readonly failureThreshold: number;
  readonly stallThresholdMs: number;
  readonly thresholdReachedOrExceeded: boolean;
  readonly trackStallAlerted: boolean;
  readonly logRecoveryOnSuccess: boolean;

  private readonly onError?: (
    failureType: string,
    payload: Record<string, unknown>,
  ) => void;
  private readonly onAlert?: (payload: Record<string, unknown>) => void;
  private readonly onRecovery?: (hadFailures: boolean) => void;
  private readonly onStall?: (info: Record<string, unknown>) => void;

  protected consecutiveFailures = 0;
  protected lastSuccessfulAt: number | null = null;
  protected alertActive = false;
  protected stallAlerted = false;

  constructor(options: FailureMonitorOptions = {}) {
    this.name = options.name ?? "failure_monitor";
    this.logComponent = options.logComponent ?? this.name;
    this.payloadKey = options.payloadKey ?? "component";
    this.failureThreshold = options.failureThreshold ?? 3;
    this.stallThresholdMs = options.stallThresholdMs ?? 120_000;
    this.thresholdReachedOrExceeded = options.thresholdReachedOrExceeded ?? false;
    this.trackStallAlerted = options.trackStallAlerted ?? false;
    this.logRecoveryOnSuccess = options.logRecoveryOnSuccess ?? true;
    this.onError = options.onError;
    this.onAlert = options.onAlert;
    this.onRecovery = options.onRecovery;
    this.onStall = options.onStall;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  getFailureThreshold(): number {
    return this.failureThreshold;
  }

  getLastSuccessfulAt(): number | null {
    return this.lastSuccessfulAt;
  }

  isAlertActive(): boolean {
    return this.alertActive;
  }

  getStallThresholdMs(): number {
    return this.stallThresholdMs;
  }

  /**
   * Record a failure. Notifies via `onError` on every call and via `onAlert`
   * when the threshold is first reached. Returns the new consecutive-failure count.
   */
  recordFailure(
    failureType: string,
    details: FailureMonitorFailureDetails = {},
  ): number {
    this.consecutiveFailures += 1;

    const payload: Record<string, unknown> = {
      failureType,
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.failureThreshold,
      error: details.error,
      ...details,
    };
    payload[this.payloadKey] = this.name;

    this.onError?.(failureType, payload);

    const thresholdReached = this.thresholdReachedOrExceeded
      ? this.consecutiveFailures >= this.failureThreshold
      : this.consecutiveFailures === this.failureThreshold;

    if (thresholdReached && (!this.alertActive || this.thresholdReachedOrExceeded)) {
      this.alertActive = true;
      this.onAlert?.({
        ...payload,
        action: `Inspect ${this.logComponent} health; alerting clears automatically after the next successful operation.`,
      });
    }

    return this.consecutiveFailures;
  }

  /** Record a success, clearing any active alert. Notifies via `onRecovery`. */
  recordSuccess(): void {
    const hadFailures = this.consecutiveFailures > 0 || this.alertActive;
    this.consecutiveFailures = 0;
    this.lastSuccessfulAt = Date.now();
    if (hadFailures && this.logRecoveryOnSuccess) {
      this.onRecovery?.(hadFailures);
    }
    this.alertActive = false;
    if (this.trackStallAlerted) {
      this.stallAlerted = false;
    }
  }

  /**
   * Warn once per quiet period when nothing has succeeded inside the stall
   * window. Notifies via `onStall`. Returns true when a stall was reported.
   */
  checkStall(): boolean {
    if (this.lastSuccessfulAt === null) return false;
    const elapsedMs = Date.now() - this.lastSuccessfulAt;
    if (elapsedMs <= this.stallThresholdMs) return false;
    if (this.trackStallAlerted && this.stallAlerted) return true;

    if (this.trackStallAlerted) {
      this.stallAlerted = true;
    }

    this.onStall?.({
      [this.payloadKey]: this.name,
      failureType: "stall",
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.failureThreshold,
      stallThresholdMs: this.stallThresholdMs,
      elapsedMs,
      action: `No successful ${this.logComponent} operation within the stall window; inspect health.`,
    });
    return true;
  }

  /** Reset all state in place. */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessfulAt = null;
    this.alertActive = false;
    this.stallAlerted = false;
  }
}
