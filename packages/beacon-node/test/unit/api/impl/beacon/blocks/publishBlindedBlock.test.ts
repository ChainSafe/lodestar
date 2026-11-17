import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {SubmitBlindedBlockResponse} from "../../../../../../src/chain/beaconEngine/interface.js";
import {getApiTestModules} from "../../../../../utils/api.js";

describe.each([false, true])("api - beacon - publishBlindedBlockV2 (response bytes: %s)", (withResponseBytes) => {
  afterEach(() => vi.restoreAllMocks());

  it.each([ForkName.capella, ForkName.deneb] as const)("rejects publishing returned contents for %s", async (fork) => {
    const config = createBeaconConfig(
      {
        ...configDef,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: fork === ForkName.deneb ? 0 : Infinity,
      },
      new Uint8Array(32)
    );
    const modules = getApiTestModules({config});
    modules.network.publishBeaconBlock = vi.fn();
    const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
    const signedBlindedBlock = ssz.deneb.SignedBlindedBeaconBlock.defaultValue();
    const bytes = ssz[fork].SignedBlindedBeaconBlock.serialize(signedBlindedBlock);
    const response = defer<SubmitBlindedBlockResponse>();
    const submit = vi.fn().mockReturnValue(response.promise);
    modules.chain.beaconEngine.submitBlindedBlock = submit;
    const publishing = getBeaconBlockApi(defaultApiOptions, modules).publishBlindedBlockV2(
      {signedBlindedBlock, broadcastValidation: routes.beacon.BroadcastValidation.gossip},
      {sszBytes: bytes}
    );
    expect(submit).toHaveBeenCalledExactlyOnceWith(bytes, signedBlindedBlock, fork);
    expect(submit.mock.calls[0][0]).toBe(bytes);
    expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    response.resolve({
      signedBlockContents: {signedBlock},
      contentsBytes: withResponseBytes ? ssz[fork].SignedBeaconBlock.serialize(signedBlock) : undefined,
    });
    await expect(publishing).rejects.toThrow(`Publishing blocks is not supported for pre-fulu fork=${fork}`);
    expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
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
      const publishing = getBeaconBlockApi(defaultApiOptions, modules).publishBlindedBlockV2(
        {signedBlindedBlock},
        {sszBytes: sszRequest ? bytes : null}
      );
      expect(submit).toHaveBeenCalledExactlyOnceWith(bytes, signedBlindedBlock, ForkName.fulu);
      if (sszRequest) expect(submit.mock.calls[0][0]).toBe(bytes);
      const error = new Error("Builder submission failed");
      response.reject(error);
      await expect(publishing).rejects.toBe(error);
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();

      submit.mockResolvedValueOnce(undefined);
      await getBeaconBlockApi(defaultApiOptions, modules).publishBlindedBlockV2(
        {signedBlindedBlock},
        {sszBytes: bytes}
      );
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    }
  );
});
