import {ProofType, Tree, computeDescriptor, concatGindices} from "@chainsafe/persistent-merkle-tree";
import {ContainerType, type JsonPath} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {createGloasState, gloasConfig} from "./gloasFixture.js";
import {createStfState, stfConfig} from "./stfFixture.js";

const terminalPaths: {name: string; path: JsonPath}[] = [
  {name: "slot", path: ["slot"]},
  {name: "first balance chunk", path: ["balances", 0]},
  {name: "second balance chunk", path: ["balances", 4]},
  {name: "last populated balance chunk", path: ["balances", 15]},
  {name: "zero block root", path: ["blockRoots", 0]},
];

describe.each(["fulu", "gloas"] as const)("%s native compact proofs", (fork) => {
  const type = ssz[fork].BeaconState;
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
  let config: InstanceType<typeof bindings.BeaconConfig>;
  let state: InstanceType<typeof bindings.BeaconStateView>;
  let bytes: Uint8Array;
  let reference: Tree;

  beforeAll(() => {
    pubkeyCache.ensureCapacity(16);
    bytes =
      fork === "fulu"
        ? ssz.fulu.BeaconState.serialize(createStfState())
        : ssz.gloas.BeaconState.serialize(createGloasState());
    config = new bindings.BeaconConfig(fork === "fulu" ? stfConfig : gloasConfig, new Uint8Array(32));
    reference = new Tree(type.deserializeToView(bytes).node);
    state = bindings.BeaconStateView.createFromBytes(bytes, config);
    expect(state.forkName).toBe(fork);
    expect(state.hashTreeRoot()).toEqual(reference.root);
    expect(reference.getRoot(credentialsGindex)).toEqual(new Uint8Array(32));
  });

  afterAll(() => state?.release());

  function expectProof(gindices: bigint[]): void {
    const descriptor = computeDescriptor(gindices);
    const proof = state.createMultiProof(descriptor);
    expect(proof).toEqual(reference.getProof({descriptor, type: ProofType.compactMulti}));
    const reconstructed = Tree.createFromProof(proof);
    expect(reconstructed.root).toEqual(reference.root);
    for (const gindex of gindices) {
      expect(reconstructed.getRoot(gindex), `target ${gindex}`).toEqual(reference.getRoot(gindex));
    }
    expect(state.hashTreeRoot()).toEqual(reference.root);
  }

  it("preserves root-only proofs", () => {
    expectProof([1n]);
  });

  it("preserves multi-target proofs through containers and packed balances", () => {
    expectProof(targets.map(({gindex}) => gindex));
  });

  it.each(targets)("distinguishes traversal below $name and recovers", ({gindex}) => {
    for (const child of [gindex * 2n, gindex * 2n + 1n]) {
      const descriptor = computeDescriptor([child]);
      expect(() => state.createMultiProof(descriptor), `child ${child}`).toThrowError(
        expect.objectContaining({
          code: "INVALID_PROOF_TRAVERSAL",
          message: "Proof descriptor requests children of a terminal chunk",
        })
      );
      expectProof([gindex]);
    }
  });

  it.each([
    {descriptor: [], name: "empty"},
    {descriptor: [0x00], name: "incomplete"},
    {descriptor: [0xff], name: "nonzero padding"},
  ])("preserves STATE_ERROR for a $name descriptor", ({descriptor}) => {
    expect(() => state.createMultiProof(Uint8Array.from(descriptor))).toThrowError(
      expect.objectContaining({code: "STATE_ERROR", message: "Failed to create proof"})
    );
    expectProof([type.getPathInfo(["slot"]).gindex]);
  });

  it("keeps released-state failures distinct from traversal errors", () => {
    const released = bindings.BeaconStateView.createFromBytes(bytes, config);
    released.release();
    expect(() => released.createMultiProof(computeDescriptor([1n]))).toThrowError(
      expect.objectContaining({code: "InvalidState"})
    );
  });
});
