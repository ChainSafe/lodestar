import {beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {BeaconBlock, ssz} from "@lodestar/types";
import {ForkChoice, ProtoArray} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, headSlot, makeStore, parentSlot, toProtoBlock} from "./proposerHeadTestUtils.js";

class ExposedForkChoice extends ForkChoice {
  receivedTimely(block: BeaconBlock, blockDelayMs: number): boolean {
    return this.isBlockReceivedTimely(block, blockDelayMs);
  }
  ptcTimely(block: BeaconBlock, blockDelayMs: number): boolean {
    return this.isBlockPtcTimely(block, blockDelayMs);
  }
  importedTimely(block: BeaconBlock, importDelayMs: number): boolean {
    return this.isBlockImportedTimely(block, importDelayMs);
  }
}

describe("Forkchoice / block timeliness", () => {
  // At 10 s slots the gloas deadlines are not whole seconds, so the comparison must be exact at
  // the millisecond: ATTESTATION_DUE_BPS_GLOAS = 2500 ms, PAYLOAD_ATTESTATION_DUE_BPS = 7500 ms
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
    SLOT_DURATION_MS: 10_000,
  });
  const store = makeStore();
  const attestationDueMs = config.getAttestationDueMs(config.getForkName(store.currentSlot));
  const ptcDueMs = config.getSlotComponentDurationMs(
    config.getForkName(store.currentSlot),
    config.PAYLOAD_ATTESTATION_DUE_BPS
  );

  let forkChoice: ExposedForkChoice;
  let block: BeaconBlock;

  beforeEach(() => {
    const genesisRoot = getBlockRoot(genesisSlot);
    const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
    protoArray.onBlock(toProtoBlock(parentSlot, genesisRoot, true), parentSlot, null);
    protoArray.onBlock(toProtoBlock(headSlot, getBlockRoot(parentSlot), true), headSlot, null);
    forkChoice = new ExposedForkChoice(config, store, protoArray, VALIDATOR_COUNT, null);
    block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = store.currentSlot;
  });

  it("uses millisecond deadlines", () => {
    expect(attestationDueMs).toBe(2500);
    expect(ptcDueMs).toBe(7500);
  });

  it.each([
    {delayMs: attestationDueMs - 1, expected: true},
    {delayMs: attestationDueMs, expected: false},
  ])("received $delayMs ms into the slot is timely: $expected", ({delayMs, expected}) => {
    expect(forkChoice.receivedTimely(block, delayMs)).toBe(expected);
    expect(forkChoice.importedTimely(block, delayMs)).toBe(expected);
  });

  it.each([
    {delayMs: ptcDueMs - 1, expected: true},
    {delayMs: ptcDueMs, expected: false},
  ])("received $delayMs ms into the slot is PTC timely: $expected", ({delayMs, expected}) => {
    expect(forkChoice.ptcTimely(block, delayMs)).toBe(expected);
  });

  it("is never timely for a block of a past slot", () => {
    block.slot = store.currentSlot - 1;
    expect(forkChoice.receivedTimely(block, 0)).toBe(false);
    expect(forkChoice.ptcTimely(block, 0)).toBe(false);
    expect(forkChoice.importedTimely(block, 0)).toBe(false);
  });
});
