import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {ProofType, Tree, computeDescriptor, concatGindices} from "@chainsafe/persistent-merkle-tree";
import {ContainerType, type JsonPath} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {IBeaconStateView} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";
import {createBeaconStateView} from "../../../src/stateView/stateViewFactory.js";
import {generateValidators} from "../../utils/validator.js";

const terminalPaths: {name: string; path: JsonPath}[] = [
  {name: "slot", path: ["slot"]},
  {name: "first balance chunk", path: ["balances", 0]},
  {name: "second balance chunk", path: ["balances", 4]},
  {name: "last populated balance chunk", path: ["balances", 15]},
  {name: "zero block root", path: ["blockRoots", 0]},
];

describe.each([
  {backend: "TypeScript", nativeStateTransition: false},
  {backend: "native", nativeStateTransition: true},
])("$backend compact proofs", ({nativeStateTransition}) => {
  describe.each([ForkName.fulu, ForkName.gloas] as const)("%s", (fork) => {
    const type = sszTypesFor(fork).BeaconState;
    const config = createBeaconConfig(getConfig(fork), new Uint8Array(32));
    // ValidatorNodeStruct stops path navigation at the record root.
    const validatorType = new ContainerType(ssz.phase0.Validator.fields);
    const credentialsGindex = concatGindices([
      type.getPathInfo(["validators", 0]).gindex,
      validatorType.getPathInfo(["withdrawalCredentials"]).gindex,
    ]);
    const targets = [
      ...terminalPaths.map(({name, path}) => ({gindex: type.getPathInfo(path).gindex, name})),
      {gindex: credentialsGindex, name: "validator withdrawal credentials"},
    ];
    let view: IBeaconStateView;
    let stateBytes: Uint8Array;
    let reference: Tree;
    let expectedRoot: Uint8Array;

    beforeAll(() => {
      const state = type.defaultValue();
      state.slot = 3 * SLOTS_PER_EPOCH;
      state.validators = generateValidators(16, {
        activation: 0,
        exit: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
        balance: MAX_EFFECTIVE_BALANCE,
      });
      state.validators[0].withdrawalCredentials = new Uint8Array(32).fill(7);
      state.balances = state.validators.map((_, i) => MAX_EFFECTIVE_BALANCE + i);
      state.inactivityScores = state.validators.map(() => 0);
      state.previousEpochParticipation = state.validators.map(() => 0);
      state.currentEpochParticipation = state.validators.map(() => 0);
      state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
      state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
      pubkeyCache.ensureCapacity(state.validators.length);
      stateBytes = type.serialize(state);
      view = createBeaconStateView({nativeStateTransition, config, stateBytes});
      expect(view).toBeInstanceOf(nativeStateTransition ? NativeBeaconStateView : BeaconStateView);
      reference = new Tree(type.toView(state).node);
      expectedRoot = type.hashTreeRoot(state);
      expect(view.forkName).toBe(fork);
      expect(view.hashTreeRoot()).toEqual(expectedRoot);
      expect(reference.getRoot(credentialsGindex)).toEqual(state.validators[0].withdrawalCredentials);
    });

    afterAll(() => view?.release());

    function expectProof(gindices: bigint[], context: string): void {
      const descriptor = computeDescriptor(gindices);
      const proof = view.createMultiProof(descriptor);
      expect(proof, `${context}: proof`).toEqual(reference.getProof({type: ProofType.compactMulti, descriptor}));
      const reconstructed = Tree.createFromProof(proof);
      expect(reconstructed.root, `${context}: reconstructed root`).toEqual(expectedRoot);
      for (const gindex of gindices) {
        expect(reconstructed.getRoot(gindex), `${context}: target ${gindex}`).toEqual(reference.getRoot(gindex));
      }
      expect(view.hashTreeRoot(), `${context}: original state root`).toEqual(expectedRoot);
    }

    it("preserves root-only proofs", () => {
      expectProof([1n], "root-only");
    });

    it("preserves multi-target proofs through containers and packed balances", () => {
      expectProof(
        targets.map(({gindex}) => gindex),
        "multi-target"
      );
    });

    it.each(targets)("distinguishes traversal below $name and recovers", ({gindex}) => {
      for (const child of [gindex * 2n, gindex * 2n + 1n]) {
        expect(() => view.createMultiProof(computeDescriptor([child])), `child ${child}`).toThrowError(
          expect.objectContaining({
            code: "INVALID_PROOF_TRAVERSAL",
            message: "Proof descriptor requests children of a terminal chunk",
          })
        );
        expectProof([gindex], `after rejecting child ${child}`);
      }
    });

    it.each([
      {descriptor: [], name: "empty"},
      {descriptor: [0x00], name: "incomplete"},
      {descriptor: [0xff], name: "nonzero padding"},
    ])("preserves descriptor validation errors for a $name descriptor", ({descriptor, name}) => {
      expect(() => view.createMultiProof(Uint8Array.from(descriptor))).toThrowError(
        nativeStateTransition
          ? expect.objectContaining({code: "STATE_ERROR", message: "Failed to create proof"})
          : /^Invalid descriptor:/
      );
      expectProof([type.getPathInfo(["slot"]).gindex], `after rejecting ${name} descriptor`);
    });

    if (nativeStateTransition) {
      it("keeps released-state failures distinct from traversal errors", () => {
        const released = createBeaconStateView({nativeStateTransition, config, stateBytes});
        released.release();
        expect(() => released.createMultiProof(computeDescriptor([1n]))).toThrowError(
          expect.objectContaining({code: "InvalidState"})
        );
      });
    } else {
      it.each([
        {property: "left", gindex: 2n},
        {property: "right", gindex: 3n},
        {property: "root", gindex: 1n},
      ] as const)("preserves unexpected $property failures without classifying by message", ({property, gindex}) => {
        if (!(view instanceof BeaconStateView)) throw Error("Expected TypeScript state view");
        const failure = new Error("LeafNode has no left node");
        const spy = vi.spyOn(view.cachedState.node, property, "get").mockImplementation(() => {
          throw failure;
        });
        let caught: unknown;
        try {
          view.createMultiProof(computeDescriptor([gindex]));
        } catch (error) {
          caught = error;
        } finally {
          spy.mockRestore();
        }
        expect(caught).toBe(failure);
        expectProof([type.getPathInfo(["slot"]).gindex], `after restoring ${property}`);
      });
    }
  });
});
