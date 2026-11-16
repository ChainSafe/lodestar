import {beforeEach, describe, expect, it} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {validateBuilderApiExecutionPayloadBid} from "../../../../src/execution/builder/validateBid.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateBuilderApiExecutionPayloadBid", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );
  const slot = 2;
  const parentBlockRoot = Buffer.alloc(32, 5);
  const parentBlockHash = Buffer.alloc(32, 6);
  const parentPayloadRoot = Buffer.alloc(32, 4);
  // The last pre-gloas block: fork choice tracks the root of its payload
  const parentBlock = generateProtoBlock({
    slot: slot - 1,
    blockRoot: toRootHex(parentBlockRoot),
    executionPayloadBlockHash: toRootHex(parentBlockHash),
    executionPayloadRoot: toRootHex(parentPayloadRoot),
    executionPayloadNumber: 1,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
  });
  let chain: MockedBeaconChain;
  let signedBid: ReturnType<typeof ssz.gloas.SignedExecutionPayloadBid.defaultValue>;

  function validate(): Promise<void> {
    return validateBuilderApiExecutionPayloadBid(chain, signedBid, {
      slot,
      parentBlock,
      parentBlockHash: toRootHex(parentBlockHash),
      parentPayloadRoot: toRootHex(parentPayloadRoot),
      parentBlockRoot: toRootHex(parentBlockRoot),
      entry: {} as routes.validator.BuilderEntry,
      getParentExecutionRequests: async () => ssz.gloas.ExecutionRequests.defaultValue(),
    });
  }

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = slot;
    signedBid.message.parentBlockRoot = parentBlockRoot;
    signedBid.message.parentBlockHash = parentBlockHash;
    signedBid.message.parentPayloadRoot = parentPayloadRoot;
    signedBid.message.blockHash = Buffer.alloc(32, 9);
    signedBid.message.payloadRoot = Buffer.alloc(32, 10);
  });

  it("rejects a bid which does not build on the requested parent payload root", async () => {
    signedBid.message.parentPayloadRoot = Buffer.alloc(32, 13);
    await expect(validate()).rejects.toThrow(
      `Bid parentPayloadRoot=${toRootHex(Buffer.alloc(32, 13))} does not match requested parentPayloadRoot=${toRootHex(parentPayloadRoot)}`
    );
    // Checked against the request, before the state is regenerated
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });
});
