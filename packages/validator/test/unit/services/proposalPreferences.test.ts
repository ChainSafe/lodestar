import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {Mocked, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {HttpStatusCode, routes} from "@lodestar/api";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {LogLevel, defer, fromHex, toRootHex} from "@lodestar/utils";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ProposalPreferencesService} from "../../../src/services/proposalPreferences.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/services/blockDuties.js");

describe("ProposalPreferencesService", () => {
  const api = getApiClientStub();
  const gloasConfig = createChainForkConfig({
    ...defaultConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const builderUrl = "https://builder.example.com";
  const dependentRoot = `0x${"11".repeat(32)}`;
  const proposalSlot = 12;

  // @ts-expect-error - Mocked class don't need parameters
  const blockDutiesService = new BlockDutiesService() as Mocked<BlockDutiesService>;

  let secretKeys: SecretKey[];
  let duties: routes.validator.ProposerDuty[];
  let validatorStore: ValidatorStore;
  let controller: AbortController;
  let clock: ClockMock;

  function mockDuties(epoch: number, root: string, data: routes.validator.ProposerDuty[]): void {
    blockDutiesService.getProposersAtEpoch.mockImplementation((dutyEpoch) =>
      dutyEpoch === epoch ? {dependentRoot: root, data} : undefined
    );
  }

  function startService(config: ChainForkConfig, store: ValidatorStore): void {
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    new ProposalPreferencesService(config, loggerVc, api, clock, store, blockDutiesService, syncingStatusTracker, null);
  }

  beforeAll(async () => {
    secretKeys = [SecretKey.fromBytes(toBufferBE(1n, 32))];
    duties = [{slot: proposalSlot, validatorIndex: 0, pubkey: secretKeys[0].toPublicKey().toBytes()}];
    validatorStore = await initValidatorStore(secretKeys, api, gloasConfig, {
      defaultConfig: {builder: {builders: [{url: builderUrl}]}},
      proposerConfig: {},
    });
  });

  beforeEach(() => {
    controller = new AbortController();
    clock = new ClockMock();
    mockDuties(0, dependentRoot, duties);
    api.validator.submitProposerPreferences.mockResolvedValue(mockApiResponse({}));
    api.validator.submitBuilderPreferences.mockResolvedValue(mockApiResponse({}));
    api.node.getSyncingStatus.mockResolvedValue(
      mockApiResponse({data: {headSlot: 0, syncDistance: 0, isSyncing: false, isOptimistic: false, elOffline: false}})
    );
  });

  afterEach(() => {
    controller.abort();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("signs and submits the preferences of a proposal once within the window", async () => {
    const signSpy = vi.spyOn(validatorStore, "signProposerPreferences");
    startService(gloasConfig, validatorStore);

    await clock.tickSlotFns(proposalSlot - 2, controller.signal);
    await clock.tickSlotFns(proposalSlot - 1, controller.signal);

    expect(signSpy).toHaveBeenCalledOnce();
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
    const [[{signedProposerPreferences}]] = api.validator.submitProposerPreferences.mock.calls;
    expect(signedProposerPreferences).toHaveLength(1);
    expect(signedProposerPreferences[0].message).toMatchObject({
      proposalSlot,
      validatorIndex: 0,
      dependentRoot: fromHex(dependentRoot),
    });

    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce();
    const [[{builderPreferences}]] = api.validator.submitBuilderPreferences.mock.calls;
    expect(builderPreferences).toHaveLength(1);
    expect(new TextDecoder().decode(builderPreferences[0].url)).toBe(builderUrl);
    expect(builderPreferences[0].auth.message.slot).toBe(proposalSlot);
    expect(builderPreferences[0].proposerPubkey).toEqual(duties[0].pubkey);
  });

  it("resubmits the preferences when the dependent root shifts", async () => {
    const signSpy = vi.spyOn(validatorStore, "signProposerPreferences");
    startService(gloasConfig, validatorStore);

    await clock.tickSlotFns(proposalSlot - 2, controller.signal);
    const shiftedDependentRoot = `0x${"22".repeat(32)}`;
    mockDuties(0, shiftedDependentRoot, duties);
    await clock.tickSlotFns(proposalSlot - 1, controller.signal);

    expect(signSpy).toHaveBeenCalledTimes(2);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledTimes(2);
    const [, [second]] = api.validator.submitProposerPreferences.mock.calls;
    expect(toRootHex(second.signedProposerPreferences[0].message.dependentRoot)).toBe(shiftedDependentRoot);
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledTimes(2);
  });

  it("only submits the preferences of proposals within the submission window", async () => {
    startService(gloasConfig, validatorStore);

    await clock.tickSlotFns(proposalSlot - SLOTS_PER_EPOCH / 4 - 1, controller.signal);
    expect(api.validator.submitProposerPreferences).not.toHaveBeenCalled();
    expect(api.validator.submitBuilderPreferences).not.toHaveBeenCalled();

    await clock.tickSlotFns(proposalSlot - SLOTS_PER_EPOCH / 4, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce();

    await clock.tickSlotFns(proposalSlot, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce();
  });

  it("does not submit builder preferences for validators without builders", async () => {
    const store = await initValidatorStore(secretKeys, api, gloasConfig);
    startService(gloasConfig, store);

    await clock.tickSlotFns(proposalSlot - 1, controller.signal);

    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
    expect(api.validator.submitBuilderPreferences).not.toHaveBeenCalled();
  });

  it("retries a failed submission on the next slot without resubmitting the other preferences", async () => {
    api.validator.submitProposerPreferences.mockResolvedValueOnce(
      await mockApiErrorResponse(HttpStatusCode.BAD_REQUEST)
    );
    const errorSpy = vi.spyOn(loggerVc, LogLevel.error);
    startService(gloasConfig, validatorStore);

    await clock.tickSlotFns(proposalSlot - 2, controller.signal);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error submitting signed proposer preferences",
      {count: 1},
      expect.any(Error)
    );

    await clock.tickSlotFns(proposalSlot - 1, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledTimes(2);
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce();
  });

  it("resubmits the preferences within the window after the beacon node resynced", async () => {
    startService(gloasConfig, validatorStore);

    await clock.tickSlotFns(proposalSlot - 3, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();

    // The beacon node is unreachable for a slot, e.g. while it restarts
    api.node.getSyncingStatus.mockRejectedValueOnce(new Error("fetch failed"));
    await clock.tickSlotFns(proposalSlot - 2, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();

    await clock.tickSlotFns(proposalSlot - 1, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledTimes(2);
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledTimes(2);
  });

  it("submits builder preferences while proposer preferences are still being signed", async () => {
    const signing = defer<gloas.SignedProposerPreferences>();
    vi.spyOn(validatorStore, "signProposerPreferences").mockReturnValue(signing.promise);
    startService(gloasConfig, validatorStore);

    const tick = clock.tickSlotFns(proposalSlot - 1, controller.signal);
    await vi.waitFor(() => expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce());
    expect(api.validator.submitProposerPreferences).not.toHaveBeenCalled();

    signing.resolve(ssz.gloas.SignedProposerPreferences.defaultValue());
    await tick;
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
  });

  it("submits the preferences of the first gloas proposals before the fork", async () => {
    const config = createChainForkConfig({...gloasConfig, GLOAS_FORK_EPOCH: 1});
    const store = await initValidatorStore(secretKeys, api, config, {
      defaultConfig: {builder: {builders: [{url: builderUrl}]}},
      proposerConfig: {},
    });
    const firstGloasSlot = SLOTS_PER_EPOCH;
    mockDuties(1, dependentRoot, [{slot: firstGloasSlot, validatorIndex: 0, pubkey: duties[0].pubkey}]);
    startService(config, store);

    await clock.tickSlotFns(firstGloasSlot - SLOTS_PER_EPOCH / 4 - 1, controller.signal);
    expect(api.validator.submitProposerPreferences).not.toHaveBeenCalled();

    await clock.tickSlotFns(firstGloasSlot - SLOTS_PER_EPOCH / 4, controller.signal);
    expect(api.validator.submitProposerPreferences).toHaveBeenCalledOnce();
    expect(api.validator.submitBuilderPreferences).toHaveBeenCalledOnce();
  });
});
