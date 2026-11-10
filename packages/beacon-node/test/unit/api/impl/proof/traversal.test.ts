import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ProofType, Tree, computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {createFastifyRoutes} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateView,
  NativeBeaconStateView,
  createBeaconStateView,
  interopSecretKey,
} from "@lodestar/state-transition";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {RestApiServer} from "../../../../../src/api/rest/base.js";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {IBeaconSync, SyncState} from "../../../../../src/sync/index.js";
import {getMockedLogger} from "../../../../mocks/loggerMock.js";

const config = createBeaconConfig(getConfig(ForkName.gloas, 2), new Uint8Array(32));
const activationSlot = 2 * SLOTS_PER_EPOCH;

class ProofServer extends RestApiServer {
  constructor(api: ReturnType<typeof getProofApi>) {
    super({port: 0}, {logger: getMockedLogger(), metrics: null});
    const proofRoutes = createFastifyRoutes(routes.proof.getDefinitions(config), api);
    this.server.route(proofRoutes.getStateProof);
    this.server.route(proofRoutes.getBlockProof);
  }

  request(kind: "state" | "block", id: string, descriptor: Uint8Array, accept: string) {
    return this.server.inject({
      method: "GET",
      url: `/eth/v0/beacon/proof/${kind}/${id}?format=${toHex(descriptor)}`,
      headers: {accept},
    });
  }
}

function createStateFixture(fork: ForkName.fulu | ForkName.gloas) {
  const type = sszTypesFor(fork).BeaconState;
  const state = type.defaultValue();
  state.slot = fork === ForkName.fulu ? activationSlot - 1 : activationSlot;
  state.validators = Array.from({length: 16}, (_, i) => ({
    ...ssz.phase0.Validator.defaultValue(),
    pubkey: interopSecretKey(i).toPublicKey().toBytes(),
    activationEpoch: 0,
    exitEpoch: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
  }));
  state.balances = state.validators.map((_, i) => MAX_EFFECTIVE_BALANCE + i);
  state.previousEpochParticipation = state.validators.map(() => 0);
  state.currentEpochParticipation = state.validators.map(() => 0);
  state.inactivityScores = state.validators.map(() => 0);
  state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  return {type, state, bytes: type.serialize(state)};
}

describe.each([
  {backend: "TypeScript", nativeStateTransition: false},
  {backend: "native", nativeStateTransition: true},
])("$backend proof HTTP traversal", ({nativeStateTransition}) => {
  describe.each([ForkName.fulu, ForkName.gloas] as const)("%s", (fork) => {
    const fixture = createStateFixture(fork);
    const blockType = sszTypesFor(fork).BeaconBlock;
    const block = blockType.defaultValue();
    block.slot = fixture.state.slot;
    block.stateRoot = fixture.type.hashTreeRoot(fixture.state);
    const stateRoot = toHex(block.stateRoot);
    const blockRoot = toHex(blockType.hashTreeRoot(block));
    const getStateByStateRoot = vi.fn<IBeaconChain["getStateByStateRoot"]>();
    const getHistoricalStateBySlot = vi.fn<IBeaconChain["getHistoricalStateBySlot"]>();
    const getBlockByRoot = vi.fn<IBeaconChain["getBlockByRoot"]>();
    let state: IBeaconStateView;
    let head: IBeaconStateView;
    let server: ProofServer;
    const loaded: IBeaconStateView[] = [];

    beforeAll(() => {
      pubkeyCache.ensureCapacity(fixture.state.validators.length);
      state = createBeaconStateView({nativeStateTransition, config, stateBytes: fixture.bytes});
      head = createBeaconStateView({
        nativeStateTransition,
        config,
        stateBytes: createStateFixture(ForkName.gloas).bytes,
      });
      expect(state).toBeInstanceOf(nativeStateTransition ? NativeBeaconStateView : BeaconStateView);
      expect(state.forkName).toBe(fork);
      expect(head.forkName).toBe(ForkName.gloas);
      // Only retrieval dependencies are mocked; routes, state loading, and proof generation are real.
      const chain = {
        getStateByStateRoot,
        getHistoricalStateBySlot,
        getBlockByRoot,
        getHeadState: () => head,
        clock: {currentSlot: activationSlot + SLOTS_PER_EPOCH},
        forkChoice: {getFinalizedBlock: () => ({slot: activationSlot + 1})},
      } as unknown as IBeaconChain;
      server = new ProofServer(
        getProofApi(defaultApiOptions, {
          config,
          chain,
          sync: {state: SyncState.Synced} as IBeaconSync,
          db: {} as ApiModules["db"],
        })
      );
    });

    beforeEach(() => {
      getStateByStateRoot.mockReset().mockResolvedValue({state, executionOptimistic: false, finalized: false});
      getHistoricalStateBySlot
        .mockReset()
        .mockResolvedValue({state: fixture.bytes, executionOptimistic: false, finalized: true});
      getBlockByRoot.mockReset().mockResolvedValue({
        block: {message: block, signature: new Uint8Array(96)},
        executionOptimistic: false,
        finalized: false,
      });
      const load = head.loadOtherState.bind(head);
      vi.spyOn(head, "loadOtherState").mockImplementation((bytes) => {
        const view = load(bytes);
        loaded.push(view);
        vi.spyOn(view, "release");
        return view;
      });
      vi.spyOn(state, "release");
    });

    afterEach(() => {
      vi.restoreAllMocks();
      for (const view of loaded.splice(0)) view.release();
    });

    afterAll(async () => {
      await server?.close();
      state?.release();
      head?.release();
    });

    describe.each(["cached state", "historical state", "block"] as const)("%s", (source) => {
      const kind = source === "block" ? "block" : "state";
      const id = source === "block" ? blockRoot : source === "cached state" ? stateRoot : String(fixture.state.slot);
      const type = source === "block" ? blockType : fixture.type;
      const slotGindex = type.getPathInfo(["slot"]).gindex;
      const reference = new Tree(
        source === "block" ? blockType.toView(block).node : fixture.type.toView(fixture.state).node
      );

      it.each(["application/json", "application/octet-stream"])(
        "returns 400 for terminal traversal with %s",
        async (accept) => {
          for (const child of [2n * slotGindex, 2n * slotGindex + 1n]) {
            const response = await server.request(kind, id, computeDescriptor([child]), accept);
            expect(response.statusCode, `child ${child}`).toBe(400);
            expect(response.headers["content-type"], `child ${child}`).toContain("application/json");
            expect(response.json(), `child ${child}`).toEqual({
              code: 400,
              message: "Proof descriptor requests children of a terminal chunk",
            });
          }
          expect(state.release).not.toHaveBeenCalled();
          for (const [i, view] of loaded.entries()) expect(view.release, `loaded state ${i}`).toHaveBeenCalledTimes(1);
        }
      );

      it("still serves a valid proof with the selected fork and target", async () => {
        const response = await server.request(kind, id, computeDescriptor([slotGindex]), "application/json");
        expect(response.statusCode).toBe(200);
        const body = response.json<{version: string; data: unknown}>();
        expect(body.version).toBe(fork);
        const proof = {
          type: ProofType.compactMulti as const,
          ...routes.proof.CompactMultiProofType.fromJson(body.data),
        };
        const tree = Tree.createFromProof(proof);
        expect(tree.root).toEqual(reference.root);
        expect(tree.getRoot(slotGindex)).toEqual(reference.getRoot(slotGindex));
        expect(state.release).not.toHaveBeenCalled();
        for (const [i, view] of loaded.entries()) expect(view.release, `loaded state ${i}`).toHaveBeenCalledTimes(1);
      });

      it("preserves retrieval failures as 500 even if they carry the traversal code", async () => {
        const error = Object.assign(new Error("Retrieval failed"), {code: "INVALID_PROOF_TRAVERSAL"});
        const retrieval =
          source === "block"
            ? getBlockByRoot
            : source === "cached state"
              ? getStateByStateRoot
              : getHistoricalStateBySlot;
        retrieval.mockRejectedValueOnce(error);
        const response = await server.request(kind, id, computeDescriptor([1n]), "application/json");
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({code: 500, message: "Retrieval failed"});
      });
    });

    it.each(["STATE_ERROR", "InvalidState", undefined])(
      "preserves backend failure %s as 500 without matching messages",
      async (code) => {
        vi.spyOn(state, "createMultiProof").mockImplementationOnce(() => {
          throw Object.assign(new Error("Proof descriptor requests children of a terminal chunk"), {code});
        });
        const response = await server.request("state", stateRoot, computeDescriptor([1n]), "application/json");
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({code: 500, message: "Proof descriptor requests children of a terminal chunk"});
        expect(state.release).not.toHaveBeenCalled();
      }
    );

    it("preserves unexpected block tree failures as 500", async () => {
      const view = blockType.toView(block);
      vi.spyOn(view.node, "root", "get").mockImplementationOnce(() => {
        throw new Error("LeafNode has no left node");
      });
      vi.spyOn(blockType, "toView").mockReturnValueOnce(view);
      const response = await server.request("block", blockRoot, computeDescriptor([1n]), "application/json");
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({code: 500, message: "LeafNode has no left node"});
    });

    it("releases an owned historical state after an unexpected proof failure", async () => {
      const load = head.loadOtherState.bind(head);
      vi.spyOn(head, "loadOtherState").mockImplementationOnce((bytes) => {
        const view = load(bytes);
        vi.spyOn(view, "createMultiProof").mockImplementationOnce(() => {
          throw new Error("Proof backend failed");
        });
        return view;
      });
      const response = await server.request(
        "state",
        String(fixture.state.slot),
        computeDescriptor([1n]),
        "application/json"
      );
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({code: 500, message: "Proof backend failed"});
      expect(loaded).toHaveLength(1);
      expect(loaded[0].release).toHaveBeenCalledTimes(1);
    });
  });
});
