import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkPostGloas} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {createGenesisBlock} from "../../../src/chain/initState.js";

describe("createGenesisBlock", () => {
  it("Should set state root and leave default body for pre-Gloas genesis", () => {
    const phase0Config = createChainForkConfig(defaultChainConfig);
    const phase0State = ssz.phase0.BeaconState.defaultViewDU();
    const expectedStateRoot = phase0State.hashTreeRoot();

    const block = createGenesisBlock(phase0Config, phase0State);

    expect(block.message.stateRoot).toEqual(expectedStateRoot);
    expect(ssz.phase0.BeaconBlockBody.equals(block.message.body, ssz.phase0.BeaconBlockBody.defaultValue())).toBe(true);
  });

  it("Should inject state.latestExecutionPayloadBid into body for Gloas genesis", () => {
    const gloasConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });

    // Mirror the spec helper `create_genesis_state`: populate latestExecutionPayloadBid
    // with execution_requests_root = hash_tree_root(ExecutionRequests()) and derive
    // latestBlockHeader.bodyRoot from a body whose bid message matches.
    // See https://github.com/ethereum/consensus-specs/pull/5173 and
    // https://github.com/ethpandaops/eth-beacon-genesis/issues/76.
    const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
    bid.executionRequestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(
      ssz.electra.ExecutionRequests.defaultValue()
    );

    const expectedBody = ssz.gloas.BeaconBlockBody.defaultValue();
    expectedBody.signedExecutionPayloadBid.message = bid;

    const state = ssz.gloas.BeaconState.defaultViewDU();
    state.latestExecutionPayloadBid = ssz.gloas.ExecutionPayloadBid.toViewDU(bid);
    state.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
      slot: 0,
      proposerIndex: 0,
      parentRoot: new Uint8Array(32),
      stateRoot: new Uint8Array(32),
      bodyRoot: ssz.gloas.BeaconBlockBody.hashTreeRoot(expectedBody),
    });
    state.commit();

    const block = createGenesisBlock(gloasConfig, state) as SignedBeaconBlock<ForkPostGloas>;

    expect(block.message.stateRoot).toEqual(state.hashTreeRoot());
    expect(ssz.gloas.ExecutionPayloadBid.equals(block.message.body.signedExecutionPayloadBid.message, bid)).toBe(true);
    // Consistency check used by persistAnchorState: the body root of the constructed
    // genesis block must match latestBlockHeader.bodyRoot from the anchor state.
    expect(ssz.gloas.BeaconBlockBody.hashTreeRoot(block.message.body)).toEqual(state.latestBlockHeader.bodyRoot);
  });
});
