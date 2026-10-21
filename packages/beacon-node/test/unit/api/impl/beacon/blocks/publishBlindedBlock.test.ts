import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {signedBeaconBlockToBlinded} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {
  BlockInputBlobs,
  BlockInputPreData,
  BlockInputSource,
} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {getApiTestModules} from "../../../../../utils/api.js";

describe("api - beacon - publishBlindedBlockV2", () => {
  it.each([false, true])(
    "publishes full block bytes returned by the engine before Fulu (SSZ request: %s)",
    async (sszRequest) => {
      const config = createBeaconConfig(
        {...configDef, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 0},
        new Uint8Array(32)
      );
      const modules = getApiTestModules({config});
      modules.network.publishBeaconBlock = vi.fn();
      const signedBlindedBlock = ssz.capella.SignedBlindedBeaconBlock.defaultValue();
      const bytes = ssz.capella.SignedBlindedBeaconBlock.serialize(signedBlindedBlock);
      const signedBlock = ssz.capella.SignedBeaconBlock.defaultValue();
      const response = defer<Uint8Array>();
      const submit = vi.fn().mockReturnValue(response.promise);
      modules.chain.beaconEngine.submitBlindedBlock = submit;
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputPreData.createFromBlock({
          block: signedBlock,
          blockRootHex: toRootHex(ssz.capella.BeaconBlock.hashTreeRoot(signedBlock.message)),
          forkName: ForkName.capella,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
        })
      );
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);

      const publishing = getBeaconBlockApi(modules).publishBlindedBlockV2(
        {signedBlindedBlock, broadcastValidation: routes.beacon.BroadcastValidation.none},
        {sszBytes: sszRequest ? bytes : null}
      );
      expect(submit).toHaveBeenCalledExactlyOnceWith(bytes, ForkName.capella);
      if (sszRequest) expect(submit.mock.calls[0][0]).toBe(bytes);
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      response.resolve(ssz.capella.SignedBeaconBlock.serialize(signedBlock));
      await publishing;
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledExactlyOnceWith(signedBlock);
      expect(modules.chain.processBlock).toHaveBeenCalledWith(expect.anything(), {ignoreIfKnown: true});
    }
  );

  it.each([false, true])("publishes serialized Deneb contents (cached response: %s)", async (cachedResponse) => {
    const config = createBeaconConfig(
      {...configDef, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 0, DENEB_FORK_EPOCH: 0},
      new Uint8Array(32)
    );
    const modules = getApiTestModules({config});
    modules.network.publishBeaconBlock = vi.fn();
    modules.network.publishBlobSidecar = vi.fn();
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
    const contents = ssz.deneb.SignedBlockContents.defaultValue();
    contents.signedBlock.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
    contents.blobs.push(ssz.deneb.Blob.defaultValue());
    contents.kzgProofs.push(ssz.deneb.KZGProof.defaultValue());
    const contentsBytes = ssz.deneb.SignedBlockContents.serialize(contents);
    const blockRoot = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(contents.signedBlock.message));
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
      BlockInputBlobs.createFromBlock({
        block: contents.signedBlock,
        blockRootHex: blockRoot,
        forkName: ForkName.deneb,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
      })
    );
    modules.chain.beaconEngine.submitBlindedBlock = vi.fn().mockResolvedValue(contentsBytes);
    if (cachedResponse) modules.chain.serializedCache.set(contents, contentsBytes);
    const deserialize = vi.spyOn(ssz.deneb.SignedBlockContents, "deserialize");
    try {
      await getBeaconBlockApi(modules).publishBlindedBlockV2({
        signedBlindedBlock: signedBeaconBlockToBlinded(config, contents.signedBlock),
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      });
      expect(deserialize).toHaveBeenCalledTimes(cachedResponse ? 0 : 1);
    } finally {
      deserialize.mockRestore();
    }
    expect(modules.network.publishBeaconBlock).toHaveBeenCalledExactlyOnceWith(contents.signedBlock);
    expect(modules.network.publishBlobSidecar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        blob: contents.blobs[0],
        kzgProof: contents.kzgProofs[0],
      })
    );
    const publishedBlock = vi.mocked(modules.network.publishBeaconBlock).mock.calls[0][0];
    const blockBytes = modules.chain.serializedCache.get(publishedBlock);
    expect(blockBytes).toEqual(ssz.deneb.SignedBeaconBlock.serialize(contents.signedBlock));
    expect(blockBytes?.buffer).toBe(contentsBytes.buffer);
  });

  it.each([false, true])(
    "awaits engine submission in Fulu without locally publishing a block (SSZ request: %s)",
    async (sszRequest) => {
      const config = createBeaconConfig(
        {
          ...configDef,
          ALTAIR_FORK_EPOCH: 0,
          BELLATRIX_FORK_EPOCH: 0,
          CAPELLA_FORK_EPOCH: 0,
          DENEB_FORK_EPOCH: 0,
          ELECTRA_FORK_EPOCH: 0,
          FULU_FORK_EPOCH: 0,
        },
        new Uint8Array(32)
      );
      const modules = getApiTestModules({config});
      modules.network.publishBeaconBlock = vi.fn();
      const signedBlindedBlock = ssz.fulu.SignedBlindedBeaconBlock.defaultValue();
      const bytes = ssz.fulu.SignedBlindedBeaconBlock.serialize(signedBlindedBlock);
      const response = defer<void>();
      const submit = vi.fn().mockReturnValue(response.promise);
      modules.chain.beaconEngine.submitBlindedBlockNoResponse = submit;
      const publishing = getBeaconBlockApi(modules).publishBlindedBlockV2(
        {signedBlindedBlock},
        {sszBytes: sszRequest ? bytes : null}
      );
      expect(submit).toHaveBeenCalledExactlyOnceWith(bytes, ForkName.fulu);
      if (sszRequest) expect(submit.mock.calls[0][0]).toBe(bytes);
      const error = new Error("Builder submission failed");
      response.reject(error);
      await expect(publishing).rejects.toBe(error);
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();

      submit.mockResolvedValueOnce(undefined);
      await getBeaconBlockApi(modules).publishBlindedBlockV2({signedBlindedBlock}, {sszBytes: bytes});
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    }
  );
});
