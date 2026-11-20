import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiClient} from "@lodestar/api";
import {SpecJson, chainConfigToJson} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, gloas, ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {
  MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES,
  ProposerPreferencesRecovery,
  ProposerPreferencesRecoveryOptions,
} from "../../../src/services/proposerPreferencesRecovery.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {mockApiResponse} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";

const genesisValidatorsRoot = toRootHex(Buffer.alloc(32, 7));
const genesisTime = 1_700_000_000;

type SourceStub = {
  beacon: {getGenesis: ReturnType<typeof vi.fn>; getProposerPreferences: ReturnType<typeof vi.fn>};
  config: {getSpec: ReturnType<typeof vi.fn>};
};

describe("ProposerPreferencesRecovery", () => {
  const config = getConfig(ForkName.gloas);
  let logger: ReturnType<typeof getMockedLogger>;
  let tracker: ProposerPreferencesTracker;
  let controller: AbortController;
  let primary: SourceStub;

  beforeEach(() => {
    logger = getMockedLogger();
    tracker = new ProposerPreferencesTracker();
    controller = new AbortController();
    primary = getSourceStub({});
  });

  afterEach(() => {
    controller.abort();
  });

  function getSourceStub({
    preferences = [],
    genesis = {genesisValidatorsRoot: Buffer.alloc(32, 7), genesisTime, genesisForkVersion: Buffer.alloc(4)},
    spec = {},
  }: {
    preferences?: gloas.SignedProposerPreferences[];
    genesis?: {genesisValidatorsRoot: Uint8Array; genesisTime: number; genesisForkVersion: Uint8Array};
    spec?: SpecJson;
  }): SourceStub {
    return {
      beacon: {
        getGenesis: vi.fn().mockResolvedValue(mockApiResponse({data: genesis, meta: undefined})),
        getProposerPreferences: vi
          .fn()
          .mockResolvedValue(mockApiResponse({data: preferences, meta: {version: ForkName.gloas}})),
      },
      config: {getSpec: vi.fn().mockResolvedValue(mockApiResponse({data: spec, meta: undefined}))},
    };
  }

  function getRecovery(
    additional: {id: string; api: SourceStub}[],
    opts: Partial<ProposerPreferencesRecoveryOptions> = {}
  ): ProposerPreferencesRecovery {
    return new ProposerPreferencesRecovery(
      {config, logger, tracker, metrics: null, signal: controller.signal},
      {
        primary: {id: "primary", api: primary as unknown as ApiClient},
        additional: additional.map(({id, api}) => ({id, api: api as unknown as ApiClient})),
        genesisValidatorsRoot,
        genesisTime,
        timeoutMs: 250,
        ...opts,
      }
    );
  }

  it("recovers preferences the primary missed from a verified additional source", async () => {
    const known = preferences(2, 1);
    const missed = preferences(3, 1);
    primary = getSourceStub({preferences: [known]});
    const peer = getSourceStub({preferences: [known, missed]});
    const recovery = getRecovery([{id: "peer", api: peer}]);

    await recovery.refresh(0);

    expect(tracker.get(2, root(1))).toBe(known);
    expect(tracker.get(3, root(1))).toBe(missed);
    expect(peer.beacon.getGenesis).toHaveBeenCalledExactlyOnceWith({signal: controller.signal, timeoutMs: 250});
    expect(peer.config.getSpec).toHaveBeenCalledOnce();
    expect(peer.beacon.getProposerPreferences).toHaveBeenCalledExactlyOnceWith(undefined, {
      signal: controller.signal,
      timeoutMs: 250,
    });
    expect(logger.info).toHaveBeenCalledWith("Verified proposer preferences source", {source: "peer"});
    expect(logger.info).toHaveBeenCalledWith("Recovered proposer preferences", {
      source: "peer",
      count: 2,
      added: 1,
      ignored: 0,
    });
    expect(logger.warn).not.toHaveBeenCalled();

    await recovery.refresh(0);
    expect(peer.beacon.getGenesis).toHaveBeenCalledOnce();
    expect(peer.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);
    expect(logger.verbose).toHaveBeenCalledWith("No proposer preferences to recover", {
      source: "peer",
      count: 2,
      added: 0,
      ignored: 0,
    });
  });

  it("merges by slot and dependent root, retaining the first entry per identity", async () => {
    const first = preferences(2, 1, 1);
    const sameIdentity = preferences(2, 1, 2);
    const otherBranch = preferences(2, 2);
    primary = getSourceStub({preferences: [first]});
    const peer = getSourceStub({preferences: [sameIdentity, otherBranch]});

    await getRecovery([{id: "peer", api: peer}]).refresh(0);

    expect(tracker.get(2, root(1))).toBe(first);
    expect(tracker.get(2, root(2))).toBe(otherBranch);
    expect(tracker.count(2)).toBe(2);
  });

  it("keeps the responses of other sources when one source fails", async () => {
    const recovered = preferences(2, 1);
    primary.beacon.getProposerPreferences.mockRejectedValue(Error("primary down"));
    const broken = getSourceStub({});
    broken.beacon.getProposerPreferences.mockRejectedValue(Error("timeout"));
    const peer = getSourceStub({preferences: [recovered]});
    const recovery = getRecovery([
      {id: "broken", api: broken},
      {id: "peer", api: peer},
    ]);

    await recovery.refresh(0);
    expect(tracker.get(2, root(1))).toBe(recovered);
    expect(logger.warn).toHaveBeenCalledWith(
      "Unable to fetch proposer preferences",
      {source: "primary"},
      Error("primary down")
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Unable to fetch proposer preferences",
      {source: "broken"},
      Error("timeout")
    );
    expect(logger.error).not.toHaveBeenCalled();

    logger.warn.mockClear();
    await recovery.refresh(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Unable to fetch proposer preferences",
      {source: "broken"},
      Error("timeout")
    );

    broken.beacon.getProposerPreferences.mockResolvedValue(
      mockApiResponse({data: [], meta: {version: ForkName.gloas}})
    );
    await recovery.refresh(0);
    expect(logger.info).toHaveBeenCalledWith("Proposer preferences source is available again", {source: "broken"});
  });

  it("retries verification of an unavailable source without polling its preferences", async () => {
    const peer = getSourceStub({preferences: [preferences(2, 1)]});
    peer.beacon.getGenesis.mockRejectedValueOnce(Error("connection refused"));
    const recovery = getRecovery([{id: "peer", api: peer}]);

    await recovery.refresh(0);
    expect(peer.beacon.getProposerPreferences).not.toHaveBeenCalled();
    expect(tracker.count(2)).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "Unable to fetch proposer preferences",
      {source: "peer"},
      Error("connection refused")
    );

    await recovery.refresh(0);
    expect(peer.beacon.getGenesis).toHaveBeenCalledTimes(2);
    expect(tracker.get(2, root(1))).not.toBeNull();
  });

  it.each([
    ["genesis validators root", getSourceStubOnWrongNetwork({genesisValidatorsRoot: Buffer.alloc(32, 8), genesisTime})],
    [
      "genesis time",
      getSourceStubOnWrongNetwork({genesisValidatorsRoot: Buffer.alloc(32, 7), genesisTime: genesisTime + 1}),
    ],
    [
      "spec",
      getSourceStubOnWrongNetwork(
        {genesisValidatorsRoot: Buffer.alloc(32, 7), genesisTime},
        {GENESIS_FORK_VERSION: "0x99999999"}
      ),
    ],
  ])("excludes a source with a different %s", async (_reason, peer) => {
    const recovery = getRecovery([{id: "peer", api: peer}]);

    await recovery.refresh(0);
    expect(peer.beacon.getProposerPreferences).not.toHaveBeenCalled();
    expect(tracker.count(2)).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      "Excluded proposer preferences source on a different network",
      {source: "peer"},
      expect.any(Error)
    );
    expect(recovery.getSourceIds()).toEqual(["primary"]);

    await recovery.refresh(0);
    expect(peer.beacon.getGenesis).toHaveBeenCalledOnce();
    expect(peer.beacon.getProposerPreferences).not.toHaveBeenCalled();
    expect(primary.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);
  });

  it("accepts a matching spec from an additional source", async () => {
    const peer = getSourceStub({preferences: [preferences(2, 1)], spec: chainConfigToJson(config)});
    await getRecovery([{id: "peer", api: peer}]).refresh(0);
    expect(tracker.get(2, root(1))).not.toBeNull();
  });

  it("joins a refresh in progress instead of polling again", async () => {
    const pending = defer<Awaited<ReturnType<ApiClient["beacon"]["getProposerPreferences"]>>>();
    primary.beacon.getProposerPreferences.mockReturnValue(pending.promise);
    const recovery = getRecovery([]);

    const first = recovery.refresh(0);
    const second = recovery.refresh(0);
    expect(second).toBe(first);
    expect(primary.beacon.getProposerPreferences).toHaveBeenCalledOnce();

    pending.resolve(mockApiResponse({data: [], meta: {version: ForkName.gloas}}));
    await first;
    await recovery.refresh(0);
    expect(primary.beacon.getProposerPreferences).toHaveBeenCalledTimes(2);
  });

  it("filters responses to the current and next epoch and bounds roots per slot", async () => {
    const current = 2 * SLOTS_PER_EPOCH + 3;
    const inWindow = [preferences(current, 1), preferences(4 * SLOTS_PER_EPOCH - 1, 1)];
    const outOfWindow = [preferences(current - 1, 1), preferences(4 * SLOTS_PER_EPOCH, 1)];
    const crowded = [1, 2, 3, 4, 5].map((byte) => preferences(current + 1, byte));
    primary = getSourceStub({preferences: [...inWindow, ...outOfWindow, ...crowded]});

    await getRecovery([]).refresh(current);

    expect(tracker.get(current, root(1))).toBe(inWindow[0]);
    expect(tracker.get(4 * SLOTS_PER_EPOCH - 1, root(1))).toBe(inWindow[1]);
    expect(tracker.get(current - 1, root(1))).toBeNull();
    expect(tracker.get(4 * SLOTS_PER_EPOCH, root(1))).toBeNull();
    expect(tracker.count(current + 1)).toBe(4);
    expect(logger.info).toHaveBeenCalledWith("Recovered proposer preferences", {
      source: "primary",
      count: 9,
      added: 6,
      ignored: 3,
    });
  });

  it("skips polling while the next epoch is before Gloas", async () => {
    const recovery = new ProposerPreferencesRecovery(
      {config: getConfig(ForkName.gloas, 10), logger, tracker, metrics: null, signal: controller.signal},
      {
        primary: {id: "primary", api: primary as unknown as ApiClient},
        additional: [],
        genesisValidatorsRoot,
        genesisTime,
        timeoutMs: 250,
      }
    );

    await recovery.refresh(8 * SLOTS_PER_EPOCH);
    expect(primary.beacon.getProposerPreferences).not.toHaveBeenCalled();

    await recovery.refresh(9 * SLOTS_PER_EPOCH);
    expect(primary.beacon.getProposerPreferences).toHaveBeenCalledOnce();
  });

  it("ignores responses that complete after shutdown and does not poll afterwards", async () => {
    const pending = defer<Awaited<ReturnType<ApiClient["beacon"]["getProposerPreferences"]>>>();
    primary.beacon.getProposerPreferences.mockReturnValue(pending.promise);
    const recovery = getRecovery([]);

    const refreshing = recovery.refresh(0);
    controller.abort();
    pending.resolve(mockApiResponse({data: [preferences(2, 1)], meta: {version: ForkName.gloas}}));
    await refreshing;
    expect(tracker.count(2)).toBe(0);
    expect(logger.info).not.toHaveBeenCalled();

    await recovery.refresh(0);
    expect(primary.beacon.getProposerPreferences).toHaveBeenCalledOnce();
  });

  it("does not report failures caused by shutdown", async () => {
    const pending = defer<Awaited<ReturnType<ApiClient["beacon"]["getProposerPreferences"]>>>();
    primary.beacon.getProposerPreferences.mockReturnValue(pending.promise);
    const recovery = getRecovery([]);

    const refreshing = recovery.refresh(0);
    controller.abort();
    pending.reject(Error("aborted"));
    await refreshing;
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("does not continue verification after a genesis response arrives during shutdown", async () => {
    const pending = defer<Awaited<ReturnType<ApiClient["beacon"]["getGenesis"]>>>();
    const peer = getSourceStub({});
    peer.beacon.getGenesis.mockReturnValue(pending.promise);
    const recovery = getRecovery([{id: "peer", api: peer}]);

    const refreshing = recovery.refresh(0);
    controller.abort();
    pending.resolve(
      mockApiResponse({
        data: {genesisValidatorsRoot: Buffer.alloc(32, 7), genesisTime, genesisForkVersion: Buffer.alloc(4)},
        meta: undefined,
      })
    );
    await refreshing;

    expect(peer.config.getSpec).not.toHaveBeenCalled();
    expect(peer.beacon.getProposerPreferences).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rejects more additional sources than allowed", () => {
    const additional = Array.from({length: MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES + 1}, (_, i) => ({
      id: `peer-${i}`,
      api: getSourceStub({}),
    }));
    expect(() => getRecovery(additional)).toThrow("At most 3 additional proposer preferences sources");
  });

  function getSourceStubOnWrongNetwork(
    genesis: {genesisValidatorsRoot: Uint8Array; genesisTime: number},
    spec: SpecJson = {}
  ): SourceStub {
    return {
      beacon: {
        getGenesis: vi
          .fn()
          .mockResolvedValue(
            mockApiResponse({data: {...genesis, genesisForkVersion: Buffer.alloc(4)}, meta: undefined})
          ),
        getProposerPreferences: vi
          .fn()
          .mockResolvedValue(mockApiResponse({data: [preferences(2, 1)], meta: {version: ForkName.gloas}})),
      },
      config: {getSpec: vi.fn().mockResolvedValue(mockApiResponse({data: spec, meta: undefined}))},
    };
  }
});

function preferences(proposalSlot: number, dependentRootByte: number, feeRecipientByte = 1) {
  const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
  signed.message.proposalSlot = proposalSlot;
  signed.message.dependentRoot = Uint8Array.from({length: 32}, () => dependentRootByte);
  signed.message.feeRecipient = Uint8Array.from({length: 20}, () => feeRecipientByte);
  return signed;
}

function root(byte: number): RootHex {
  return toRootHex(Uint8Array.from({length: 32}, () => byte));
}
