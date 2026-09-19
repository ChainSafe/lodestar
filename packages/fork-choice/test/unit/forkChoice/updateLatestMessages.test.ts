import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {IndexedAttestation, RootHex, Slot} from "@lodestar/types";
import {ForkChoice, ProtoArray} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {
  VALIDATOR_COUNT,
  genesisEpoch,
  genesisSlot,
  getPayloadBlockHash,
  gloasConfig,
  makeStore,
  toProtoBlock,
} from "./proposerHeadTestUtils.js";

const earlierSlot = genesisSlot + 1;
const laterSlot = genesisSlot + 2;

function toAttestation(slot: Slot, blockRoot: RootHex): IndexedAttestation {
  const root = fromHexString(blockRoot);
  return {
    attestingIndices: [0],
    data: {
      slot,
      index: 0,
      beaconBlockRoot: root,
      source: {epoch: genesisEpoch, root: fromHexString(getBlockRoot(genesisSlot))},
      target: {epoch: genesisEpoch, root},
    },
    signature: new Uint8Array(96),
  };
}

/** Two competing blocks on genesis, the same validator votes for each of them in the same epoch */
function headAfterSameEpochVotes(config: ChainForkConfig, isGloas: boolean): RootHex {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(toProtoBlock(earlierSlot, genesisRoot, isGloas), earlierSlot, null);
  protoArray.onBlock(
    toProtoBlock(laterSlot, genesisRoot, isGloas, isGloas ? {parentBlockHash: getPayloadBlockHash(genesisSlot)} : {}),
    laterSlot,
    null
  );

  const forkChoice = new ForkChoice(config, makeStore(), protoArray, VALIDATOR_COUNT, null);
  forkChoice.onAttestation(toAttestation(earlierSlot, getBlockRoot(earlierSlot)), "0xearlier");
  forkChoice.onAttestation(toAttestation(laterSlot, getBlockRoot(laterSlot)), "0xlater");

  return forkChoice.updateHead().blockRoot;
}

describe("Forkchoice / update_latest_messages", () => {
  it("pre-gloas keeps the first vote of an epoch", () => {
    expect(headAfterSameEpochVotes(defaultConfig, false)).toBe(getBlockRoot(earlierSlot));
  });

  it("gloas replaces the vote with one from a later slot of the same epoch", () => {
    expect(headAfterSameEpochVotes(gloasConfig, true)).toBe(getBlockRoot(laterSlot));
  });
});
