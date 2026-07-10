import {describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {AttestationErrorCode} from "../../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {validateApiAttestation} from "../../../../../src/chain/validation/index.js";
import {config, slots} from "../../../../utils/blocksAndData.js";
import {expectRejectedWithLodestarError} from "../../../../utils/errors.js";

// Gloas: an index==1 ("payload present for a past block") attestation whose referenced payload was
// rejected by the EL at import must be gossip-REJECTed, not accepted. The EL can reject a payload with
// two distinct fork-choice representations, both covered here:
//   - imported (VALID/SYNCING) then invalidated via latest-valid-hash -> FULL variant is `Invalid`.
//   - rejected immediately at import (`newPayload` -> INVALID) -> no FULL variant, but the payload
//     input is flagged (`payloadFailedValidation`). This is the adversarial-builder case: a CL-valid
//     envelope the EL says is invalid, so `importExecutionPayload` throws before `onExecutionPayload`.
describe("validateAttestation / gloas index-1 payload-failed REJECT", () => {
  const gloasSlot = slots.gloas;
  const attSlot = gloasSlot + 1;
  const beaconBlockRoot = Buffer.alloc(32, 0xd1);
  const beaconBlockRootHex = toHexString(beaconBlockRoot);

  function pastBlock(): ProtoBlock {
    // Past block (slot < attSlot) so the index-0 same-slot REJECT does not fire and we reach the
    // payload-status checks for a past block.
    return {slot: gloasSlot, blockRoot: beaconBlockRootHex} as ProtoBlock;
  }

  function getChain({
    fullExecutionStatus,
    payloadFailedValidation,
  }: {
    fullExecutionStatus: ExecutionStatus | null;
    payloadFailedValidation: boolean;
  }): IBeaconChain {
    const block = pastBlock();
    const forkChoice = {
      getBlockDefaultStatus: (root) => (toHexString(root) === beaconBlockRootHex ? block : null),
      getBlockHex: (rootHex, payloadStatus) => {
        if (rootHex !== beaconBlockRootHex || payloadStatus !== PayloadStatus.FULL) return null;
        if (fullExecutionStatus === null) return null;
        return {...block, executionStatus: fullExecutionStatus} as ProtoBlock;
      },
    } as Partial<IForkChoice> as IForkChoice;

    return {
      config,
      forkChoice,
      seenPayloadEnvelope: vi.fn().mockReturnValue(true),
      payloadFailedValidation: vi.fn().mockReturnValue(payloadFailedValidation),
    } as unknown as IBeaconChain;
  }

  function getAttestation(index: number) {
    const attestation = ssz.electra.SingleAttestation.defaultValue();
    attestation.data.slot = attSlot;
    attestation.data.index = index;
    attestation.data.beaconBlockRoot = beaconBlockRoot;
    return attestation;
  }

  it("REJECT when the payload was rejected by the EL at import (immediate INVALID, no FULL variant)", async () => {
    // Sanity: this is a gloas slot
    expect(config.getForkName(attSlot)).toBe("gloas");

    const chain = getChain({fullExecutionStatus: null, payloadFailedValidation: true});
    const fork = config.getForkName(attSlot);

    await expectRejectedWithLodestarError(
      validateApiAttestation(fork, chain, {attestation: getAttestation(1), serializedData: null}),
      AttestationErrorCode.EXECUTION_PAYLOAD_FAILED_VALIDATION
    );
    expect(chain.payloadFailedValidation).toHaveBeenCalledWith(beaconBlockRootHex);
  });

  it("REJECT when the imported FULL variant was invalidated via latest-valid-hash", async () => {
    const chain = getChain({fullExecutionStatus: ExecutionStatus.Invalid, payloadFailedValidation: false});
    const fork = config.getForkName(attSlot);

    await expectRejectedWithLodestarError(
      validateApiAttestation(fork, chain, {attestation: getAttestation(1), serializedData: null}),
      AttestationErrorCode.EXECUTION_PAYLOAD_FAILED_VALIDATION
    );
  });

  it("does NOT reject with payload-failed when payload is valid and seen (passes to later checks)", async () => {
    const chain = getChain({fullExecutionStatus: ExecutionStatus.Valid, payloadFailedValidation: false});
    const fork = config.getForkName(attSlot);

    // Should not throw EXECUTION_PAYLOAD_FAILED_VALIDATION; some later check will fail instead.
    let code: string | undefined;
    try {
      await validateApiAttestation(fork, chain, {attestation: getAttestation(1), serializedData: null});
    } catch (e) {
      code = (e as {type?: {code?: string}}).type?.code;
    }
    expect(code).not.toBe(AttestationErrorCode.EXECUTION_PAYLOAD_FAILED_VALIDATION);
  });
});
