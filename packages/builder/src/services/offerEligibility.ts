/** Volatile permission for NEW offers, independent of durable reveal ownership.
 * The constructor's lease starts before the read request, so response latency
 * consumes the allowance. Shared state invalidates all older snapshots at once.
 * Only plain data crosses the journal worker boundary; leases are never restored.
 */
export type OfferLease = {generation: string; validUntil: number; validUntilUnixMs: number; ready: boolean};
/** Exact native permission, independent of the worker that constructed these bytes. */
export type RetainedOffer = {
  id: string;
  namespace: string;
  parentHash: string;
  parentBeaconBlockRoot: string;
  blockHash: string;
  slot: string;
  closed: boolean;
  /** Invalidates renewals started before a parent-context pause. */
  pauseEpoch?: number;
  paused?: boolean;
};
export type OfferEligibility = {
  generation: string;
  doNotOfferBefore?: number;
  /** Constructor namespace captured with this immutable primary snapshot. */
  namespace?: string;
  lease: OfferLease;
  retained?: RetainedOffer;
};

export function isOfferEligible(eligibility?: OfferEligibility): boolean {
  return (
    eligibility === undefined ||
    (Date.now() >= (eligibility.doNotOfferBefore ?? 0) &&
      eligibility.retained?.closed !== true &&
      eligibility.retained?.paused !== true &&
      eligibility.lease.ready &&
      eligibility.generation === eligibility.lease.generation &&
      performance.now() < eligibility.lease.validUntil &&
      Date.now() < eligibility.lease.validUntilUnixMs)
  );
}

export function recoveredOfferEligibility(): OfferEligibility {
  return {generation: "recovered", lease: {generation: "recovered", validUntil: 0, validUntilUnixMs: 0, ready: false}};
}

/** A temporary generation transition is retriable; it is never an old payload. */
export class PayloadSourceNotReady extends Error {}
