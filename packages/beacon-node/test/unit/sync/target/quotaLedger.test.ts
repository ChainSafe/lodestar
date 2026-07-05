import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {ForkName} from "@lodestar/params";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {rateLimitQuotas} from "../../../../src/network/reqresp/rateLimit.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";
import {selectAndReservePeer} from "../../../../src/sync/target/peerSelection.js";
import {
  BY_HEAD_MIN_SPACING_MS,
  INVALID_BYTES_REPORT_THRESHOLD,
  InvalidBytesLedger,
  QuotaLedger,
  defaultQuotaLimits,
} from "../../../../src/sync/target/quotaLedger.js";

const beaconConfig = createBeaconConfig(mainnetChainConfig, ZERO_HASH);
const LIMITS = defaultQuotaLimits(beaconConfig);

function makeLedger(startMs = 0): {ledger: QuotaLedger; clock: {t: number}} {
  const clock = {t: startMs};
  return {ledger: new QuotaLedger(LIMITS, () => clock.t), clock};
}

describe("sync / target / quotaLedger", () => {
  it("mirrors the REAL inbound rate-limit table (the two tables must move together)", () => {
    const remote = rateLimitQuotas(ForkName.gloas, beaconConfig);
    const byPeer = (method: ReqRespMethod): {quota: number; quotaTimeMs: number} => {
      const q = remote[method].byPeer;
      if (q === undefined) throw new Error(`no byPeer quota for ${method}`);
      return q;
    };

    // ByHead: full remote quota at once — safety comes from one-in-flight + spacing [A11].
    expect(LIMITS.byHead.maxUnits).toBe(byPeer(ReqRespMethod.BeaconBlocksByHead).quota);
    expect(LIMITS.byHead.maxInFlight).toBe(1);
    expect(LIMITS.byHead.minSpacingMs).toBeGreaterThanOrEqual(byPeer(ReqRespMethod.BeaconBlocksByHead).quotaTimeMs);

    // ByRoot protocols: 50% of the remote quota (headroom for gossip/backfill/API sharing it).
    expect(LIMITS.blocksByRoot.maxUnits).toBe(Math.floor(byPeer(ReqRespMethod.BeaconBlocksByRoot).quota / 2));
    expect(LIMITS.columnsByRoot.maxUnits).toBe(Math.floor(byPeer(ReqRespMethod.DataColumnSidecarsByRoot).quota / 2));
    expect(LIMITS.envelopesByRoot.maxUnits).toBe(
      Math.floor(byPeer(ReqRespMethod.ExecutionPayloadEnvelopesByRoot).quota / 2)
    );
  });

  it("byHead: one in-flight per peer, >=15s spacing, full-size hops", () => {
    const {ledger, clock} = makeLedger(1000);
    expect(ledger.tryReserve("p1", "byHead", 128)).toBe(true);
    // In-flight cap blocks a concurrent request even before spacing is considered.
    expect(ledger.tryReserve("p1", "byHead", 128)).toBe(false);
    ledger.release("p1", "byHead");
    // Released, but spacing still blocks.
    expect(ledger.tryReserve("p1", "byHead", 128)).toBe(false);
    // A different peer is unaffected.
    expect(ledger.tryReserve("p2", "byHead", 128)).toBe(true);
    // After the spacing window, the same peer is grantable again.
    clock.t += BY_HEAD_MIN_SPACING_MS;
    expect(ledger.tryReserve("p1", "byHead", 128)).toBe(true);
  });

  it("PROPERTY [A11]: no grant schedule can place >128 counted blocks in any 10s remote window", () => {
    const {ledger, clock} = makeLedger(0);
    const grants: number[] = [];
    // Adversarial schedule: hammer tryReserve at random small increments, release immediately
    // (the most permissive in-flight behavior), for a simulated 10 minutes.
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    while (clock.t < 600_000) {
      if (ledger.tryReserve("p1", "byHead", 128)) {
        grants.push(clock.t);
        ledger.release("p1", "byHead");
      }
      clock.t += Math.floor(rand() * 2000); // 0..2s steps
    }
    expect(grants.length).toBeGreaterThan(10); // the schedule actually granted plenty
    // Remote GCRA counts request units in a sliding 10s window: with >=15s spacing no two
    // grants (128 each) can coexist in ANY 10s window, under any alignment.
    for (let i = 1; i < grants.length; i++) {
      expect(grants[i] - grants[i - 1]).toBeGreaterThanOrEqual(BY_HEAD_MIN_SPACING_MS);
    }
    for (const windowStart of grants) {
      const inWindow = grants.filter((g) => g >= windowStart && g < windowStart + 10_000);
      expect(inWindow.length * 128).toBeLessThanOrEqual(128);
    }
  });

  it("byRoot window budget: drains and refills by charge expiry", () => {
    const {ledger, clock} = makeLedger(1000);
    const budget = LIMITS.blocksByRoot.maxUnits; // 64 on mainnet
    expect(ledger.tryReserve("p1", "blocksByRoot", budget - 10)).toBe(true);
    ledger.release("p1", "blocksByRoot");
    expect(ledger.tryReserve("p1", "blocksByRoot", 10)).toBe(true);
    ledger.release("p1", "blocksByRoot");
    // Budget exhausted.
    expect(ledger.tryReserve("p1", "blocksByRoot", 1)).toBe(false);
    // nextAvailableMs points at the first charge's expiry.
    const at = ledger.nextAvailableMs("p1", "blocksByRoot", 1);
    expect(at).toBe(1000 + LIMITS.blocksByRoot.windowMs);
    clock.t = at;
    expect(ledger.tryReserve("p1", "blocksByRoot", 1)).toBe(true);
  });

  it("in-flight cap (2 per byRoot protocol) and release", () => {
    const {ledger} = makeLedger(1000);
    expect(ledger.tryReserve("p1", "columnsByRoot", 8)).toBe(true);
    expect(ledger.tryReserve("p1", "columnsByRoot", 8)).toBe(true);
    expect(ledger.tryReserve("p1", "columnsByRoot", 8)).toBe(false);
    ledger.release("p1", "columnsByRoot");
    expect(ledger.tryReserve("p1", "columnsByRoot", 8)).toBe(true);
    expect(ledger.inFlightTotal("p1")).toBe(2);
  });

  it("parked peers are excluded until the park expires", () => {
    const {ledger, clock} = makeLedger(1000);
    ledger.parkPeer("p1", 5000);
    expect(ledger.isParked("p1")).toBe(true);
    expect(ledger.tryReserve("p1", "blocksByRoot", 1)).toBe(false);
    expect(ledger.nextAvailableMs("p1", "blocksByRoot", 1)).toBe(6000);
    clock.t = 6000;
    expect(ledger.isParked("p1")).toBe(false);
    expect(ledger.tryReserve("p1", "blocksByRoot", 1)).toBe(true);
  });

  describe("InvalidBytesLedger [A9]", () => {
    it("pending converts to counted on invalid verdict; Low per 64MB crossed; benign discards", () => {
      const clock = {t: 0};
      const ledger = new InvalidBytesLedger(() => clock.t);
      const report = vi.fn();

      // Benign target: charges are discarded.
      ledger.charge("0xgood", "p1", INVALID_BYTES_REPORT_THRESHOLD * 3);
      ledger.discard("0xgood");
      ledger.settleInvalid("0xgood", report); // no pending left
      expect(report).not.toHaveBeenCalled();

      // Invalid target: 2.5 thresholds → two reports.
      ledger.charge("0xbad", "p1", INVALID_BYTES_REPORT_THRESHOLD * 2.5);
      ledger.charge("0xbad", "p2", 100); // tiny — no threshold crossed
      ledger.settleInvalid("0xbad", report);
      expect(report).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalledWith("p1");

      // Next crossing reports again (cumulative, not per-target).
      ledger.charge("0xbad2", "p1", INVALID_BYTES_REPORT_THRESHOLD * 0.6);
      ledger.settleInvalid("0xbad2", report);
      expect(report).toHaveBeenCalledTimes(3);
    });

    it("counted bytes decay with a half-life and are pruned when negligible", () => {
      const clock = {t: 0};
      const ledger = new InvalidBytesLedger(() => clock.t);
      ledger.charge("0xbad", "p1", INVALID_BYTES_REPORT_THRESHOLD);
      ledger.settleInvalid("0xbad", () => {});
      const initial = ledger.countedBytes("p1");
      expect(initial).toBe(INVALID_BYTES_REPORT_THRESHOLD);

      clock.t += 10 * 60_000; // one half-life
      expect(ledger.countedBytes("p1")).toBeCloseTo(initial / 2, -3);

      clock.t += 24 * 60 * 60_000; // a day — decays to dust
      ledger.sweep();
      expect(ledger.countedBytes("p1")).toBe(0);
    });
  });

  describe("selectAndReservePeer", () => {
    it("prefers advocates, respects exclusion, and reserves atomically", () => {
      const {ledger} = makeLedger(1000);
      const advocates = new Set(["adv"]);
      const connected = ["other1", "adv", "other2"];

      const first = selectAndReservePeer({kind: "blocksByRoot", units: 1, ledger, connected, advocates});
      expect(first).toBe("adv");
      // The reservation actually landed.
      expect(ledger.inFlightTotal("adv")).toBe(1);

      // Excluded advocate → falls back to the general set.
      const second = selectAndReservePeer({
        kind: "blocksByRoot",
        units: 1,
        ledger,
        connected,
        advocates,
        exclude: new Set(["adv"]),
      });
      expect(second === "other1" || second === "other2").toBe(true);
    });

    it("filters by custody OVERLAP (never requires an all-remaining custodian)", () => {
      const {ledger} = makeLedger(1000);
      const custody = new Map<string, number[]>([
        ["p1", [0, 1]],
        ["p2", [7, 8]],
      ]);
      const picked = selectAndReservePeer({
        kind: "columnsByRoot",
        units: 2,
        ledger,
        connected: ["p1", "p2"],
        custodyOverlapOf: [7, 20, 21], // p2 overlaps on 7 only — still qualifies
        getCustodyColumns: (p) => custody.get(p) ?? null,
      });
      expect(picked).toBe("p2");
    });

    it("returns null when every peer is quota-blocked", () => {
      const {ledger} = makeLedger(1000);
      expect(ledger.tryReserve("p1", "byHead", 128)).toBe(true);
      const picked = selectAndReservePeer({kind: "byHead", units: 128, ledger, connected: ["p1"]});
      expect(picked).toBeNull();
    });
  });
});
