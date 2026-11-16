import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {BUILDER_INDEX_SELF_BUILD, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {processExecutionPayloadBid} from "../../../src/block/processExecutionPayloadBid.js";
import {G2_POINT_AT_INFINITY} from "../../../src/constants/constants.js";
import {createCachedBeaconState} from "../../../src/index.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";

const latestBlockHash = Buffer.alloc(32, 0x11);
const latestPayloadRoot = Buffer.alloc(32, 0x22);

function buildState(): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const view = ssz.gloas.BeaconState.defaultViewDU();
  view.slot = 2 * SLOTS_PER_EPOCH;
  view.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GENESIS_FORK_VERSION,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: 0,
  });
  view.latestBlockHash = latestBlockHash;
  view.latestPayloadRoot = latestPayloadRoot;
  view.commit();
  return createCachedBeaconState(
    view,
    {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
    {skipSyncCommitteeCache: true}
  ) as CachedBeaconStateGloas;
}

describe("processExecutionPayloadBid", () => {
  let state: CachedBeaconStateGloas;
  /** A self-build bid that builds on the latest payload of the state */
  let signedBid: gloas.SignedExecutionPayloadBid;

  beforeEach(() => {
    state = buildState();
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.signature = G2_POINT_AT_INFINITY;
    const bid = signedBid.message;
    bid.builderIndex = BUILDER_INDEX_SELF_BUILD;
    bid.slot = state.slot;
    bid.parentBlockHash = latestBlockHash;
    bid.parentPayloadRoot = latestPayloadRoot;
    bid.blockHash = Buffer.alloc(32, 0x33);
    bid.payloadRoot = Buffer.alloc(32, 0x44);
  });

  it("accepts a bid that builds on the latest block hash and payload root of the state", () => {
    processExecutionPayloadBid(state, signedBid);

    expect(ssz.gloas.ExecutionPayloadBid.equals(state.latestExecutionPayloadBid.toValue(), signedBid.message)).toBe(
      true
    );
  });

  it("rejects a bid whose parent payload root is not the latest payload root of the state", () => {
    // the parent block hash matches, the payload root is what identifies the parent payload
    signedBid.message.parentPayloadRoot = Buffer.alloc(32, 0x55);

    expect(() => processExecutionPayloadBid(state, signedBid)).toThrow(
      /Parent payload root .* does not match state's latest payload root/
    );
  });

  it("rejects a bid whose payload root equals its parent payload root", () => {
    // another block hash, the same payload root
    signedBid.message.payloadRoot = signedBid.message.parentPayloadRoot;

    expect(() => processExecutionPayloadBid(state, signedBid)).toThrow(
      /Payload root .* must not equal its parent payload root/
    );
  });

  it("rejects a bid whose parent block hash is not the latest block hash of the state", () => {
    // the parent payload root matches
    signedBid.message.parentBlockHash = Buffer.alloc(32, 0x55);

    expect(() => processExecutionPayloadBid(state, signedBid)).toThrow(
      /Parent block hash .* does not match state's latest block hash/
    );
  });

  it("rejects a bid whose block hash equals its parent block hash", () => {
    // another payload root, the same block hash
    signedBid.message.blockHash = signedBid.message.parentBlockHash;

    expect(() => processExecutionPayloadBid(state, signedBid)).toThrow(
      /Block hash .* must not equal its parent block hash/
    );
  });
});
