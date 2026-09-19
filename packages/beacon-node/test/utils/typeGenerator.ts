import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {Slot, gloas, phase0, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../src/constants/index.js";

// Only add functions for types that need some property changed.
// For the "empty" or "zero" type just use:
// ```
// ssz.phase.TypeName.defaultValue()
// ```
// If you only need to modify the type in a single test file, add a helper there.
// Only move here if the file has to be shared between multiple files.

export const VALID_BLS_SIGNATURE_RAND = fromHex(
  "99cb82bc69b4111d1a828963f0316ec9aa38c4e9e041a8afec86cd20dfe9a590999845bf01d4689f3bbe3df54e48695e081f1216027b577c7fccf6ab0a4fcc75faf8009c6b55e518478139f604f542d138ae3bc34bad01ee6002006d64c4ff82"
);

export function generateSignedBlockAtSlot(slot: Slot): phase0.SignedBeaconBlock {
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  return block;
}

/**
 * A populated Gloas envelope whose roots, hashes and bodies are unique per slot (2 bytes of slot, so
 * >256 slots don't collide), for archive/migration/reconstruction tests that need a body to drop
 * and put back. Signature is a fixed filler, never verified.
 */
export function generateSignedExecutionPayloadEnvelope(slot: Slot): gloas.SignedExecutionPayloadEnvelope {
  const hi = (slot >> 8) & 0xff;
  const lo = slot & 0xff;
  const root32 = (tag: number): Uint8Array => Uint8Array.from([tag, hi, lo, ...new Uint8Array(29)]);

  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  const p = envelope.message.payload;
  p.slotNumber = slot; // GLOAS:EIP-7843
  p.blockNumber = slot;
  p.blockHash = root32(0xaa);
  p.stateRoot = root32(0xbb);
  p.transactions = [Uint8Array.from([lo, 1, 2]), Uint8Array.from([lo, 3, 4])];
  p.withdrawals = [{index: slot, validatorIndex: 2, address: new Uint8Array(20).fill(0xdd), amount: 99n}];
  p.blockAccessList = Uint8Array.from([lo, 0x22]); // GLOAS:EIP-7928
  envelope.message.builderIndex = 7;
  envelope.message.beaconBlockRoot = root32(0xcc);
  envelope.message.parentBeaconBlockRoot = root32(0x99);
  envelope.signature = new Uint8Array(96).fill(0xee);
  return envelope;
}

export function generateProtoBlock(overrides: Partial<ProtoBlock> = {}): ProtoBlock {
  return {
    slot: 0,
    blockRoot: ZERO_HASH_HEX,
    parentRoot: ZERO_HASH_HEX,
    stateRoot: ZERO_HASH_HEX,
    targetRoot: ZERO_HASH_HEX,

    justifiedEpoch: 0,
    justifiedRoot: ZERO_HASH_HEX,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH_HEX,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: ZERO_HASH_HEX,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: ZERO_HASH_HEX,

    timeliness: false,
    importedTimely: false,
    ptcTimeliness: false,
    proposerIndex: 0,
    payloadStatus: PayloadStatus.FULL,
    parentBlockHash: null,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    ...overrides,
  } as ProtoBlock;
}
