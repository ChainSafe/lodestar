import {expect} from "vitest";
import {Node} from "@chainsafe/persistent-merkle-tree";
import {Type, CompositeType, fromHexString, toHexString} from "@chainsafe/ssz";

type ValidTestCaseData = {
  root: string;
  serialized: string | Uint8Array;
  jsonValue: unknown;
};

/* eslint-disable no-console */

export function runValidSszTest(type: Type<unknown>, testData: ValidTestCaseData): void {
  const testDataRootHex = testData.root;
  const testDataSerialized =
    typeof testData.serialized === "string" ? fromHexString(testData.serialized) : testData.serialized;
  const testDataSerializedStr =
    typeof testData.serialized === "string" ? testData.serialized : toHexString(testData.serialized);

  if (process.env.RENDER_JSON) {
    console.log(
      JSON.stringify(
        testData.jsonValue,
        (key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        2
      )
    );
  }

  if (process.env.RENDER_SERIALIZED) {
    console.log("serialized", testDataSerializedStr);
  }

  // JSON -> value - fromJson()
  const testDataValue = wrapErr(() => type.fromJson(testData.jsonValue), "type.fromJson()");
  // Use our re-transformed to JSON to ensure the type is the safe
  const testDataJson = wrapErr(() => type.toJson(testDataValue), "type.toJson()");

  function assertBytes(bytes: Uint8Array, msg: string): void {
    expect(toHexString(bytes)).to.equal(testDataSerializedStr, `Wrong serialized - ${msg}`);
  }

  function assertValue(value: unknown, msg: string): void {
    expect(type.toJson(value)).to.deep.equal(testDataJson, `Wrong json - ${msg}`);
  }

  function assertRoot(root: Uint8Array, msg: string): void {
    expect(toHexString(root)).to.equal(testDataRootHex, `Wrong root - ${msg}`);
  }

  function assertNode(node: Node, msg: string): void {
    expect(toHexString(node.root)).to.equal(testDataRootHex, `Wrong node - ${msg}`);
  }

  {
    // value - equals
    const isEqual = wrapErr(() => type.equals(testDataValue, testDataValue), "type.equals()");
    expect(isEqual).to.equal(true, "Value is not equal to itself");
  }

  {
    // value - clone
    const isEqual = wrapErr(() => type.equals(type.clone(testDataValue), testDataValue), "type.clone()");
    expect(isEqual).to.equal(true, "Cloned value is not equal to itself");
  }

  // value -> bytes - serialize()
  const serialized = wrapErr(() => type.serialize(testDataValue), "type.serialize()");
  assertBytes(serialized, "type.serialize()");

  {
    // bytes -> value - deserialize()
    const value = wrapErr(() => type.deserialize(copy(testDataSerialized)), "type.deserialize()");
    assertValue(value, "type.deserialize()");
  }

  // To print the chunk roots of a type value
  //
  // $ RENDER_ROOTS=true ONLY_ID="4 arrays" ../../node_modules/.bin/mocha test/unit/byType/vector/valid.test.ts
  //
  // 0x0000000000000000000000000000000000000000000000000000000000000000
  if (process.env.RENDER_ROOTS) {
    if (type.isBasic) {
      console.log("ROOTS Basic", toHexString(type.serialize(testDataValue)));
    } else {
      const roots = (type as CompositeType<unknown, unknown, unknown>)["getRoots"](testDataValue);
      console.log(
        "ROOTS Composite",
        roots.map((root) => toHexString(root))
      );
    }
  }

  {
    // hashTreeRoot()
    const root = wrapErr(() => type.hashTreeRoot(testDataValue), "type.hashTreeRoot()");
    assertRoot(root, "type.hashTreeRoot()");
  }

  // value -> tree - value_toTree()
  const node = wrapErr(() => type.value_toTree(testDataValue), "type.value_toTree()");
  assertNode(node, "type.value_toTree()");

  // To print a tree a single test you are debugging do
  //
  // $ RENDER_TREE=true ONLY_ID="4 arrays" ../../node_modules/.bin/mocha test/unit/byType/vector/valid.test.ts
  //
  // '1000' => '0x0000000000000000000000000000000000000000000000000000000000000000',
  // '1001' => '0x0000000000000000000000000000000000000000000000000000000000000000',
  // '1010' => '0x40e2010000000000000000000000000000000000000000000000000000000000',
  // '1011' => '0xf1fb090000000000000000000000000000000000000000000000000000000000',
  // '1100' => '0x4794030000000000000000000000000000000000000000000000000000000000',
  // '1101' => '0xf8ad0b0000000000000000000000000000000000000000000000000000000000',
  // '1110' => '0x4e46050000000000000000000000000000000000000000000000000000000000',
  // '1111' => '0xff5f0d0000000000000000000000000000000000000000000000000000000000'
  if (process.env.RENDER_TREE) {
    renderTree(node);
  }

  {
    // tree -> bytes
    const uint8Array = new Uint8Array(type.tree_serializedSize(node));
    const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    type.tree_serializeToBytes({uint8Array, dataView}, 0, node);
    assertBytes(uint8Array, "type.tree_serializeToBytes");
  }

  {
    // tree -> value -
    const value = wrapErr(() => type.tree_toValue(node), "type.tree_toValue()");
    assertValue(value, "type.tree_toValue()");
  }

  {
    // bytes -> tree
    const uint8Array = copy(testDataSerialized);
    const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    const node = type.tree_deserializeFromBytes({uint8Array, dataView}, 0, testDataSerialized.length);
    assertNode(node, "type.tree_deserializeFromBytes()");
  }

  if (!type.isBasic) {
    const compositeType = type as CompositeType<unknown, unknown, unknown>;

    const view = compositeType.deserializeToView(copy(testDataSerialized));
    assertNode(compositeType.commitView(view), "deserializeToView");

    const viewDU = compositeType.deserializeToViewDU(copy(testDataSerialized));
    assertNode(compositeType.commitViewDU(viewDU), "deserializeToViewDU");
  }
}

function copy(buf: Uint8Array): Uint8Array {
  const copy = new Uint8Array(buf.length);
  copy.set(buf);
  return copy;
}

function wrapErr<T>(fn: () => T, prefix: string): T {
  try {
    return fn();
  } catch (e) {
    (e as Error).message = `${prefix}: ${(e as Error).message}`;
    throw e;
  }
}

export function toJsonOrString(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString(10);
  } else {
    return value;
  }
}

function renderTree(node: Node): void {
  console.log(gatherLeafNodes(node));
}

export function gatherLeafNodes(node: Node, nodes = new Map<string, string>(), gindex = "1"): Map<string, string> {
  if (node.isLeaf()) {
    nodes.set(gindex, toHexString(node.root));
  } else {
    gatherLeafNodes(node.left, nodes, gindex + "0");
    gatherLeafNodes(node.right, nodes, gindex + "1");
  }
  return nodes;
}
