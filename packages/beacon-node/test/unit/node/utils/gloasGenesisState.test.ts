import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {BeaconStateFulu, BeaconStateGloas} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {initDevState} from "../../../../src/node/utils/state.js";

describe("initDevState / gloas genesis", () => {
  const eth1BlockHash = Buffer.alloc(32, 0xbb);
  const validatorCount = 8;

  it("builds on the genesis payload and commits to no payload of its own", () => {
    const state = initDevState(getConfig(ForkName.gloas), validatorCount, {eth1BlockHash}) as BeaconStateGloas;
    const bid = state.latestExecutionPayloadBid;

    expect(toRootHex(state.latestBlockHash)).toBe(toRootHex(eth1BlockHash));
    expect(toRootHex(bid.parentBlockHash)).toBe(toRootHex(eth1BlockHash));
    expect(toRootHex(bid.blockHash)).toBe(toRootHex(Buffer.alloc(32)));
    expect(toRootHex(bid.executionRequestsRoot)).toBe(
      toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue()))
    );

    // The first block must build on the EMPTY genesis block: `bid.parent_payload_root` has to equal
    // `state.latest_payload_root`, which makes the parent FULL if it also equals the payload root of the
    // genesis bid
    expect(toRootHex(state.latestPayloadRoot)).not.toBe(toRootHex(bid.payloadRoot));
    expect(toRootHex(state.latestPayloadRoot)).not.toBe(toRootHex(Buffer.alloc(32)));
  });

  it("the root of the genesis payload commits to the same execution block as a fulu genesis", () => {
    const stateFulu = initDevState(getConfig(ForkName.fulu), validatorCount, {eth1BlockHash}) as BeaconStateFulu;
    const stateGloas = initDevState(getConfig(ForkName.gloas), validatorCount, {eth1BlockHash}) as BeaconStateGloas;
    const {
      transactionsRoot: _transactionsRoot,
      withdrawalsRoot: _withdrawalsRoot,
      ...payloadFields
    } = stateFulu.latestExecutionPayloadHeader.toValue();

    expect(toRootHex(stateGloas.latestPayloadRoot)).toBe(
      toRootHex(
        ssz.gloas.ExecutionPayload.hashTreeRoot({...ssz.gloas.ExecutionPayload.defaultValue(), ...payloadFields})
      )
    );
  });
});
