import assert from "node:assert/strict";
import {fastify} from "fastify";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {
  CompactMultiProof,
  ProofType,
  SingleProof,
  Tree,
  computeDescriptor,
  concatGindices,
} from "@chainsafe/persistent-merkle-tree";
import {Type} from "@chainsafe/ssz";
import {WireFormat, getClient, routes} from "@lodestar/api";
import {createFastifyRoutes} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {IBeaconStateView, createBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {hash, toHex} from "@lodestar/utils";
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {
  ProofTarget,
  createProofFixture,
  progressiveIndex,
  proofConfig,
  proofForks,
  proofTargets,
  schemaManifest,
} from "./fixtures.js";

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];

describe.each(proofForks)("proof schema inventory (%s)", (fork) => {
  it("accounts for every state, block and body field", () => {
    expect({
      state: schemaManifest(ssz[fork].BeaconState),
      block: schemaManifest(ssz[fork].BeaconBlock),
      body: schemaManifest(ssz[fork].BeaconBlockBody),
    }).toMatchSnapshot();
  });
});

it("rejects removed Fulu state and body paths in the Gloas schema", () => {
  for (const [before, after, paths] of [
    [ssz.fulu.BeaconState, ssz.gloas.BeaconState, [["latestExecutionPayloadHeader", "blockHash"]]],
    [
      ssz.fulu.BeaconBlock,
      ssz.gloas.BeaconBlock,
      [
        ["body", "executionPayload", "blockHash"],
        ["body", "blobKzgCommitments"],
        ["body", "executionRequests"],
      ],
    ],
  ] as const) {
    for (const path of paths) {
      expect(before.getPathInfo([...path]).gindex, path.join(".")).toBeGreaterThan(1n);
      expect(() => after.getPathInfo([...path]), path.join(".")).toThrow();
    }
  }
});

describe.each(backends)("proof fields (native=%s)", (nativeStateTransition) => {
  const modules = getApiTestModules({config: proofConfig});

  describe.each(proofForks)("%s", (fork) => {
    const {stateType, state, blockType, block} = createProofFixture(fork);
    const stateRoot = stateType.hashTreeRoot(state);
    const blockRoot = blockType.hashTreeRoot(block);
    const stateTargets = proofTargets(stateType, state);
    const blockTargets = proofTargets(blockType, block);
    let view: IBeaconStateView;
    let client: ReturnType<typeof getClient>;
    const server = fastify();

    beforeAll(async () => {
      pubkeyCache.ensureCapacity(state.validators.length);
      view = createBeaconStateView({
        nativeStateTransition,
        config: createBeaconConfig(proofConfig, state.genesisValidatorsRoot),
        stateBytes: stateType.serialize(state),
      });
      expect(view.hashTreeRoot()).toEqual(stateRoot);
      modules.chain.getHeadState.mockReturnValue(view);
      modules.chain.getStateByStateRoot = vi.fn().mockResolvedValue({state: view, executionOptimistic: false});
      modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: state.slot}));
      Object.defineProperty(modules.chain.clock, "currentSlot", {value: state.slot});
      Object.defineProperty(modules.sync, "state", {value: SyncState.Synced});
      modules.chain.getBlockByRoot.mockResolvedValue({
        block: {message: block, signature: new Uint8Array(96)},
        executionOptimistic: false,
        finalized: true,
      });
      const proofRoutes = createFastifyRoutes(
        routes.proof.getDefinitions(proofConfig),
        getProofApi(defaultApiOptions, modules)
      );
      server.route(proofRoutes.getStateProof);
      server.route(proofRoutes.getBlockProof);
      client = getClient({baseUrl: await server.listen({port: 0, host: "127.0.0.1"})}, {config: proofConfig});
    });

    afterAll(async () => {
      await server.close();
      view?.release();
    });

    for (const [kind, targets, type, root] of [
      ["state", stateTargets, stateType, stateRoot],
      ["block", blockTargets, blockType, blockRoot],
    ] as const) {
      describe(kind, () => {
        async function request(requested: ProofTarget[], format: WireFormat): Promise<CompactMultiProof> {
          const descriptor = computeDescriptor(requested.map(({gindex}) => gindex));
          const init = {responseWireFormat: format};
          const res =
            kind === "state"
              ? await client.proof.getStateProof({stateId: toHex(root), descriptor}, init)
              : await client.proof.getBlockProof({blockId: toHex(root), descriptor}, init);
          expect(res.ok, `${kind} ${format} HTTP response`).toBe(true);
          expect(res.meta().version).toBe(fork);
          return res.value();
        }

        it.each(Object.keys(type.fields))("proves %s and its nested fields over JSON and SSZ", async (field) => {
          const path = `.${field}`;
          const requested = targets.filter(
            (target) => target.path === path || target.path.startsWith(`${path}.`) || target.path.startsWith(`${path}[`)
          );
          assert(requested.length > 0);
          for (const format of [WireFormat.json, WireFormat.ssz]) {
            expectTargets(await request(requested.slice(0, 1), format), root, requested.slice(0, 1));
            // Bound each request independently of fixture size and nested array lengths.
            for (let offset = 0; offset < requested.length; offset += 32) {
              const batch = requested.slice(offset, offset + 32);
              expectTargets(await request(batch, format), root, batch);
            }
          }
        });

        it("supports mixed-depth, duplicate and overlapping targets", async () => {
          const requested = [targets[1], targets[2], ...targets.slice(-12), targets[1]];
          expectTargets(await request(requested, WireFormat.ssz), root, requested);
        });

        it("does not treat root reconstruction as evidence of an unrequested field", async () => {
          const rootOnly = await request(targets.slice(0, 1), WireFormat.json);
          expectTargets(rootOnly, root, targets.slice(0, 1));
          expect(() => Tree.createFromProof(rootOnly).getNode(targets[1].gindex)).toThrow();
          const requested = targets.slice(-4);
          const proof = await request(requested, WireFormat.ssz);
          const wrong = {...requested[0], root: Uint8Array.from(requested[0].root)};
          wrong.root[0] ^= 1;
          expect(() => expectTargets(proof, root, [wrong])).toThrow();
          const descriptor = Uint8Array.from(proof.descriptor);
          descriptor[0] ^= 0x80;
          expect(() => expectTargets({...proof, descriptor}, root, requested)).toThrow();
          expect(() => Tree.createFromProof({...proof, leaves: proof.leaves.slice(1)})).toThrow();
        });
      });
    }

    it("proves empty optional lists without confusing length with contents", async () => {
      const empty = createProofFixture(fork, false);
      const emptyView = view.loadOtherState(empty.stateType.serialize(empty.state));
      const emptyRoot = empty.stateType.hashTreeRoot(empty.state);
      try {
        const targets = proofTargets(empty.stateType, empty.state).filter(({path}) => path.endsWith(".$length"));
        for (const target of targets) {
          expectTargets(emptyView.createMultiProof(computeDescriptor([target.gindex])), emptyRoot, [target]);
        }
      } finally {
        emptyView.release();
      }
      const emptyBlockRoot = empty.blockType.hashTreeRoot(empty.block);
      const targets = proofTargets(empty.blockType, empty.block).filter(({path}) => path.endsWith(".$length"));
      modules.chain.getBlockByRoot.mockResolvedValueOnce({
        block: {message: empty.block, signature: new Uint8Array(96)},
        executionOptimistic: false,
        finalized: true,
      });
      const response = await client.proof.getBlockProof({
        blockId: toHex(emptyBlockRoot),
        descriptor: computeDescriptor(targets.map(({gindex}) => gindex)),
      });
      expect(response.meta().version).toBe(fork);
      expectTargets(response.value(), emptyBlockRoot, targets);
    });

    it("uses the independently calculated validator and balance indices", () => {
      for (const index of [0, 1, 4, 5, 20, 21, 84, 85, 2 ** 39, 2 ** 40 - 1]) {
        const validator =
          fork === "fulu"
            ? concatGindices([75n, (2n << 40n) + BigInt(index)])
            : concatGindices([2n, progressiveIndex(11n), 2n, progressiveIndex(BigInt(index))]);
        const chunk = BigInt(Math.floor(index / 4));
        const balance =
          fork === "fulu"
            ? concatGindices([76n, (2n << 38n) + chunk])
            : concatGindices([2n, progressiveIndex(12n), 2n, progressiveIndex(chunk)]);
        expect(stateType.getPathInfo(["validators", index]).gindex, `validator ${index}`).toBe(validator);
        expect(stateType.getPathInfo(["balances", index]).gindex, `balance ${index}`).toBe(balance);
        if (fork === "gloas" && index >= 2 ** 39) expect(balance).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
      }
    });

    it("requires the proven list length when interpreting a padded balance chunk", async () => {
      const shorter = stateType.clone(state);
      shorter.balances = shorter.balances.slice(0, 85);
      const shorterView = view.loadOtherState(stateType.serialize(shorter));
      try {
        const valueIndex = stateType.getPathInfo(["balances", 84]).gindex;
        expect(stateType.getPathInfo(["balances", 87]).gindex).toBe(valueIndex);
        const lengthIndex = concatGindices([stateType.getPathInfo(["balances"]).gindex, 3n]);
        const proof = shorterView.createMultiProof(computeDescriptor([valueIndex, lengthIndex]));
        const tree = Tree.createFromProof(proof);
        expect(tree.root).toEqual(stateType.hashTreeRoot(shorter));
        const leaf = tree.getNode(valueIndex).root;
        expect(new DataView(leaf.buffer, leaf.byteOffset).getBigUint64(24, true)).toBe(0n);
        const length = tree.getNode(lengthIndex).root;
        expect(new DataView(length.buffer, length.byteOffset).getBigUint64(0, true)).toBe(85n);
        expect(87).toBeGreaterThanOrEqual(shorter.balances.length);
      } finally {
        shorterView.release();
      }
    });

    it("proves all registry fields at progressive segment and packed-lane boundaries", async () => {
      for (const index of [0, 1, 3, 4, 5, 20, 21, 83, 84, 85, 87]) {
        const validatorIndex = stateType.getPathInfo(["validators", index]).gindex;
        const targets = Object.entries<Record<string, Type<unknown>>[string]>(ssz.phase0.Validator.fields).map(
          ([field, type], fieldIndex) => ({
            path: `validators[${index}].${field}`,
            gindex: concatGindices([validatorIndex, BigInt(8 + fieldIndex)]),
            root: type.hashTreeRoot(state.validators[index][field as keyof (typeof state.validators)[number]]),
          })
        );
        const descriptor = computeDescriptor(targets.map(({gindex}) => gindex));
        expectTargets(view.createMultiProof(descriptor), stateRoot, targets);
      }
    });
  });
});

function expectTargets(proof: CompactMultiProof, root: Uint8Array, targets: readonly ProofTarget[]): void {
  const tree = Tree.createFromProof(proof);
  expect(tree.root, "reconstructed root").toEqual(root);
  for (const target of targets) {
    const single = tree.getProof({type: ProofType.single, gindex: target.gindex}) as SingleProof;
    expect(single.leaf, target.path).toEqual(target.root);
    let gindex = target.gindex;
    let computed = target.root;
    for (const witness of single.witnesses) {
      computed = gindex % 2n === 0n ? hash(computed, witness) : hash(witness, computed);
      gindex >>= 1n;
    }
    expect(gindex, `${target.path} depth`).toBe(1n);
    expect(computed, `${target.path} single proof`).toEqual(root);
  }
}
