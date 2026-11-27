import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {isFinalizedPayloadOrphaned} from "../../../../../../src/api/impl/beacon/blocks/utils.js";
import {getDebugApi} from "../../../../../../src/api/impl/debug/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {IBeaconChain} from "../../../../../../src/chain/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

describe("api - finalized block whose payload is orphaned", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const slot = 10;
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  const blockRootHex = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();

  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;
  let debugApi: ReturnType<typeof getDebugApi>;

  function setup({
    inForkChoice,
    payloadStatus,
    finalizedSlot = slot + 1,
  }: {
    inForkChoice: boolean;
    payloadStatus: PayloadStatus;
    finalizedSlot?: number;
  }): void {
    modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: finalizedSlot}));
    // Finalized, as `getCanonicalBlockAtSlot` reports it before and after the archiver migrated the block
    modules.chain.getCanonicalBlockAtSlot.mockResolvedValue({block, executionOptimistic: false, finalized: true});
    modules.forkChoice.hasBlockHexUnsafe = vi.fn().mockReturnValue(inForkChoice);
    modules.forkChoice.getCanonicalBlockAtSlot.mockReturnValue(
      generateProtoBlock({slot, blockRoot: blockRootHex, payloadStatus})
    );
    modules.chain.getExecutionPayloadEnvelope = vi.fn().mockResolvedValue(envelope);
  }

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getBeaconBlockApi(defaultApiOptions, modules);
    debugApi = getDebugApi(modules);
  });

  it("does not serve the envelope while the canonical variant is EMPTY", async () => {
    setup({inForkChoice: true, payloadStatus: PayloadStatus.EMPTY});
    await expect(api.getSignedExecutionPayloadEnvelope({blockId: String(slot)})).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(modules.chain.getExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("serves the envelope while the canonical variant is FULL", async () => {
    setup({inForkChoice: true, payloadStatus: PayloadStatus.FULL});
    const res = await api.getSignedExecutionPayloadEnvelope({blockId: String(slot)});
    expect(res.data).toBe(envelope);
    expect(res.meta.finalized).toBe(true);
  });

  it("serves the envelope of the finalized block while its canonical variant is EMPTY", async () => {
    // The finalized block's own payload is not final, a later block can still build on its FULL variant
    setup({inForkChoice: true, payloadStatus: PayloadStatus.EMPTY, finalizedSlot: slot});
    const res = await api.getSignedExecutionPayloadEnvelope({blockId: String(slot)});
    expect(res.data).toBe(envelope);
  });

  it("serves an archived envelope without walking fork choice", async () => {
    setup({inForkChoice: false, payloadStatus: PayloadStatus.EMPTY});
    const res = await api.getSignedExecutionPayloadEnvelope({blockId: String(slot)});
    expect(res.data).toBe(envelope);
    expect(modules.forkChoice.getCanonicalBlockAtSlot).not.toHaveBeenCalled();
  });

  it("does not serve blob sidecars, blobs or data column sidecars of an orphaned payload", async () => {
    setup({inForkChoice: true, payloadStatus: PayloadStatus.EMPTY});
    await expect(api.getBlobSidecars({blockId: String(slot)})).rejects.toMatchObject({statusCode: 404});
    await expect(api.getBlobs({blockId: String(slot)})).rejects.toMatchObject({statusCode: 404});
    await expect(debugApi.getDebugDataColumnSidecars({blockId: String(slot)})).rejects.toMatchObject({statusCode: 404});
  });

  describe("isFinalizedPayloadOrphaned", () => {
    function chainWith(
      inForkChoice: boolean,
      canonicalRoot: string,
      payloadStatus: PayloadStatus,
      finalizedSlot: number
    ): IBeaconChain {
      return {
        forkChoice: {
          getFinalizedBlock: () => generateProtoBlock({slot: finalizedSlot}),
          hasBlockHexUnsafe: () => inForkChoice,
          getCanonicalBlockAtSlot: () => generateProtoBlock({slot, blockRoot: canonicalRoot, payloadStatus}),
        },
      } as unknown as IBeaconChain;
    }

    it.each([
      ["EMPTY canonical variant", true, blockRootHex, PayloadStatus.EMPTY, slot + 1, true],
      ["FULL canonical variant", true, blockRootHex, PayloadStatus.FULL, slot + 1, false],
      ["EMPTY canonical variant of the finalized block", true, blockRootHex, PayloadStatus.EMPTY, slot, false],
      ["block no longer in fork choice", false, blockRootHex, PayloadStatus.EMPTY, slot + 1, false],
      ["another block canonical at the slot", true, `0x${"ab".repeat(32)}`, PayloadStatus.EMPTY, slot + 1, false],
    ])("%s", (_, inForkChoice, canonicalRoot, payloadStatus, finalizedSlot, expected) => {
      expect(
        isFinalizedPayloadOrphaned(
          chainWith(inForkChoice, canonicalRoot, payloadStatus, finalizedSlot),
          slot,
          blockRootHex
        )
      ).toBe(expected);
    });
  });
});
