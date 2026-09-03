import {beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, PAYLOAD_BUILDER_VERSION, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";

vi.mock("../../../src/util/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/util/index.js")>();
  return {
    ...actual,
    // The bid signature is not what these tests are about, and a real BLS signature would have to
    // be recomputed for every mutated field
    verifySignatureSet: vi.fn(() => true),
  };
});

const {processExecutionPayloadBid} = await import("../../../src/block/processExecutionPayloadBid.js");
const {createCachedBeaconState} = await import("../../../src/index.js");

/**
 * Characterization tests for `process_execution_payload_bid`.
 *
 * Several of these deliberately assert that Lodestar is PERMISSIVE. The gloas state transition
 * (specs/gloas/beacon-chain.md `process_execution_payload_bid`) does not constrain
 * `bid.fee_recipient` beyond copying it into the builder's pending withdrawal, never reads
 * `bid.gas_limit`, and never reads `bid.execution_payment` — those fields are only constrained by
 * IGNORE/REJECT rules on the `execution_payload_bid` gossip topic. Adding an assert here that the
 * spec does not have would make Lodestar reject blocks other clients accept and fork it off the
 * network, so the permissive behaviour is pinned on purpose.
 *
 * If one of these tests goes red because an assert was added upstream (as consensus-specs #5594
 * did for `block_hash != parent_block_hash`), the test is what should change — after confirming
 * the spec changed, not before.
 */
describe("processExecutionPayloadBid", () => {
  const slot = 1;
  const builderIndex = 0;
  const bidValue = 101_000_000;
  const attackerFeeRecipient = Buffer.alloc(20, 0xaa);

  let state: ReturnType<typeof buildGloasState>;
  let signedBid: ReturnType<typeof ssz.gloas.SignedExecutionPayloadBid.defaultValue>;

  function buildGloasState() {
    const config = getConfig(ForkName.gloas);
    const view = ssz.gloas.BeaconState.defaultViewDU();
    view.slot = slot;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GLOAS_FORK_VERSION,
      epoch: 0,
    });
    // `isActiveBuilder` requires `depositEpoch < finalizedEpoch`, both zero on a default state
    view.finalizedCheckpoint.epoch = 5;
    view.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey: Uint8Array.from({length: 48}, (_, i) => i + 1),
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress: Buffer.alloc(20, 3),
        // Must cover MIN_DEPOSIT_AMOUNT (1 ETH) on top of the bid value
        balance: 5_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    return createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    );
  }

  function pendingPayment() {
    return state.builderPendingPayments.get(SLOTS_PER_EPOCH + (slot % SLOTS_PER_EPOCH)).toValue();
  }

  beforeEach(() => {
    state = buildGloasState();
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = slot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.value = bidValue;
    // A default state has zeroed latestBlockHash, block roots and randao mixes
    signedBid.message.blockHash = Buffer.alloc(32, 9);
  });

  it("accepts a valid bid and records the pending payment", () => {
    expect(processExecutionPayloadBid(state, signedBid)).toBe(0);
    expect(pendingPayment().withdrawal.amount).toBe(bidValue);
  });

  it("throws when the bid's block hash equals its parent block hash", () => {
    // consensus-specs #5594, mirrored in the gossip and API bid validators
    signedBid.message.blockHash = signedBid.message.parentBlockHash;
    expect(() => processExecutionPayloadBid(state, signedBid)).toThrow(/must not equal its parent block hash/);
  });

  it("copies bid.feeRecipient into the pending payment verbatim, whoever it names", () => {
    // The spec places no constraint on `bid.fee_recipient`; the proposer's own preference is not
    // in the state at all, so an address the proposer never chose is a valid bid and gets paid.
    // This is why the fee recipient is enforced in the bid validators, not here.
    signedBid.message.feeRecipient = attackerFeeRecipient;
    processExecutionPayloadBid(state, signedBid);
    expect(Buffer.from(pendingPayment().withdrawal.feeRecipient)).toEqual(attackerFeeRecipient);
  });

  it("accepts a bid declaring the maximum uint64 gas limit and stores it verbatim", () => {
    // `bid.gas_limit` is never read here. The bid is includable and the envelope is then
    // unrevealable, since `verify_execution_payload_envelope` binds `payload.gas_limit`.
    // Asserting the round trip, not just "did not throw": Lodestar could equally diverge by
    // silently normalizing the field into `state.latestExecutionPayloadBid`, which is a state-root
    // divergence that `.not.toThrow()` would not see.
    signedBid.message.gasLimit = 2n ** 64n - 1n;
    processExecutionPayloadBid(state, signedBid);
    expect(state.latestExecutionPayloadBid.toValue().gasLimit).toBe(2n ** 64n - 1n);
  });

  it("accepts a bid with a non-zero execution payment and stores it verbatim", () => {
    // `bid.execution_payment` is inert in gloas: rejected on the gossip topic, but permitted
    // off-protocol (specs/gloas/builder.md) and never read by the state transition.
    signedBid.message.executionPayment = 12_345n;
    processExecutionPayloadBid(state, signedBid);
    expect(state.latestExecutionPayloadBid.toValue().executionPayment).toBe(12_345n);
  });
});
