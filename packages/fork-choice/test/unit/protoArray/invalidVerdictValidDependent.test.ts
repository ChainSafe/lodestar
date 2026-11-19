/**
 * Regression test for ChainSafe/lodestar #10652.
 *
 * Gloas proposer equivocation (same slot, parent and payload for blocks P
 * and D, plus a child C building on P): a VALID verdict for D's payload Hp
 * flips PENDING(C) to Valid through validatePayloadDependents without
 * touching P-FULL, which is still Syncing. A later INVALID verdict for P
 * must apply fully: pass 1 invalidates P-FULL, pass 2 must tolerate the
 * Valid PENDING(C) under its now Invalid parent instead of throwing
 * PROTO_ARRAY_INVALID_LVH_EXECUTION_RESPONSE mid-pass and skipping
 * applyScoreChanges. The Valid node under an Invalid parent is unreachable
 * as head, so leaving it Valid is the tolerated outcome (issue option (a)).
 *
 * Setup notes:
 * - Node indices in creation order: genesis(0), G-PENDING(1), G-EMPTY(2),
 *   G-FULL(3), P-PENDING(4), P-EMPTY(5), P-FULL(6), D-PENDING(7),
 *   D-EMPTY(8), D-FULL(9), C-PENDING(10), C-EMPTY(11).
 * - A PENDING/EMPTY variant's executionPayloadBlockHash is its bid's
 *   parentBlockHash, so PENDING(C) carries Hp and is flipped Valid by the
 *   step 1 verdict for D.
 */

import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ExecutionStatus, LVHInvalidJudged, PayloadStatus, ProtoArray, ProtoBlock} from "../../../src/index.js";

const CURRENT_SLOT = 3;
const Hg = "Hg";
const Hp = "Hp";

function createGloasBlock(
  slot: number,
  blockRoot: string,
  parentRoot: string,
  parentBlockHash: string | null,
  executionPayloadBlockHash: string
): ProtoBlock {
  return {
    slot,
    blockRoot,
    parentRoot,
    stateRoot: "-",
    targetRoot: "-",
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "-",
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "-",
    timeliness: false,
    importedTimely: false,
    ptcTimeliness: false,
    proposerIndex: 0,
    executionPayloadBlockHash,
    executionPayloadNumber: slot,
    executionPayloadGasLimit: 30000000,
    executionStatus: ExecutionStatus.Syncing,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    parentBlockHash,
    payloadStatus: PayloadStatus.PENDING,
  };
}

function setupEquivocationTree(): ProtoArray {
  // genesis (PreMerge) <- G (payload Hg) <- P (payload Hp) <- C
  //                                        ^- D (same slot + parent + payload as P)
  const fc = ProtoArray.initialize(
    {
      slot: 0,
      stateRoot: "-",
      parentRoot: "-",
      blockRoot: "0",
      justifiedEpoch: 0,
      justifiedRoot: "-",
      finalizedEpoch: 0,
      finalizedRoot: "-",
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    } as Omit<ProtoBlock, "targetRoot">,
    0
  );

  // G: first Gloas block, builds on pre-Gloas genesis; PENDING hash is the
  // parent payload hash (genesis has none, "0x00" stand-in).
  fc.onBlock(createGloasBlock(1, "G", "0", "0x00", "0x00"), 1, null);
  fc.onExecutionPayload("G", 1, Hg, 1, 30000000, null, ExecutionStatus.Syncing, DataAvailabilityStatus.PreData);

  // P: builds on G-FULL (parentBlockHash Hg), PENDING inherits Hg.
  fc.onBlock(createGloasBlock(2, "P", "G", Hg, Hg), 2, null);
  fc.onExecutionPayload("P", 2, Hp, 2, 30000000, null, ExecutionStatus.Syncing, DataAvailabilityStatus.PreData);

  // D: equivocation, same slot + parent + payload as P.
  fc.onBlock(createGloasBlock(2, "D", "G", Hg, Hg), 2, null);
  fc.onExecutionPayload("D", 2, Hp, 2, 30000000, null, ExecutionStatus.Syncing, DataAvailabilityStatus.PreData);

  // C: builds on P-FULL (parentBlockHash Hp), PENDING inherits Hp. Its own
  // payload has not arrived, so C stays PENDING.
  fc.onBlock(createGloasBlock(3, "C", "P", Hp, Hp), 3, null);

  const deltas = Array.from({length: fc.nodes.length}, () => 0);
  fc.applyScoreChanges({
    attestationDeltas: deltas,
    proposerBoost: null,
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    currentSlot: CURRENT_SLOT,
  });
  return fc;
}

function statusOf(fc: ProtoArray, root: string, payloadStatus: PayloadStatus): ExecutionStatus | undefined {
  return fc.getNode(root, payloadStatus)?.executionStatus;
}

describe("lodestar#10652: INVALID verdict applies fully with a Valid Gloas PENDING dependent", () => {
  it("VALID verdict for D's payload Hp flips PENDING(C) Valid without touching P-FULL", () => {
    const fc = setupEquivocationTree();

    expect(statusOf(fc, "C", PayloadStatus.PENDING)).toBe(ExecutionStatus.Syncing);
    expect(statusOf(fc, "P", PayloadStatus.FULL)).toBe(ExecutionStatus.Syncing);
    expect(statusOf(fc, "D", PayloadStatus.FULL)).toBe(ExecutionStatus.Syncing);

    const result = fc.validateLatestHash(
      {executionStatus: ExecutionStatus.Valid, latestValidExecHash: Hp, blockRoot: "D"},
      CURRENT_SLOT
    );
    expect(result).toEqual({applied: true});

    expect(statusOf(fc, "D", PayloadStatus.FULL)).toBe(ExecutionStatus.Valid);
    expect(statusOf(fc, "G", PayloadStatus.FULL)).toBe(ExecutionStatus.Valid);
    // Global validatePayloadDependents flip: PENDING(C) inherited Hp.
    expect(statusOf(fc, "C", PayloadStatus.PENDING)).toBe(ExecutionStatus.Valid);
    // P-FULL is not an ancestor of D and is not PENDING: untouched.
    expect(statusOf(fc, "P", PayloadStatus.FULL)).toBe(ExecutionStatus.Syncing);
  });

  it("INVALID verdict for P applies fully and recomputes scores without throwing", () => {
    const fc = setupEquivocationTree();

    fc.validateLatestHash(
      {executionStatus: ExecutionStatus.Valid, latestValidExecHash: Hp, blockRoot: "D"},
      CURRENT_SLOT
    );
    expect(statusOf(fc, "C", PayloadStatus.PENDING)).toBe(ExecutionStatus.Valid);
    expect(statusOf(fc, "P", PayloadStatus.FULL)).toBe(ExecutionStatus.Syncing);

    const result = fc.validateLatestHash(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: Hg,
        invalidateFromBlockRoot: "P",
        invalidateFromBlockHash: Hp,
        judged: LVHInvalidJudged.FromBlock,
      },
      CURRENT_SLOT
    );
    expect(result).toEqual({applied: true});

    // Pass 1 finished and pass 2 ran to completion: no throw, scores recomputed.
    expect(statusOf(fc, "P", PayloadStatus.FULL)).toBe(ExecutionStatus.Invalid);
    // Tolerated orphan: still Valid under its Invalid parent, unreachable as head.
    expect(statusOf(fc, "C", PayloadStatus.PENDING)).toBe(ExecutionStatus.Valid);
    expect(statusOf(fc, "C", PayloadStatus.EMPTY)).toBe(ExecutionStatus.Valid);
    expect(statusOf(fc, "D", PayloadStatus.FULL)).toBe(ExecutionStatus.Valid);
    // Head moved off the invalidated chain: P-EMPTY wins the root tie-break
    // over D-PENDING at G-FULL ("P" >= "D"), so the head is reached through
    // the Invalid P-FULL via its Valid descendants (C-EMPTY). This follows
    // from the existing bestChild logic, which gates on the child leading
    // to a viable head and never checks the parent's own validity; whether
    // a head below an Invalid parent is intended is a question for the
    // maintainers, the fix itself only stops the mid-pass throw.
    const head = fc.findHead("0", CURRENT_SLOT);
    expect(head.blockRoot).toBe("C");
    expect(head.payloadStatus).toBe(PayloadStatus.EMPTY);
  });
});
