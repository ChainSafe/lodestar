import {createHash} from "node:crypto";

export type CompactProof = {descriptor: Uint8Array; leaves: Uint8Array[]};

export function decodeHex(value: string): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw Error("Invalid prefixed hex bytes");
  return Buffer.from(value.slice(2), "hex");
}

export function decodeCompactProofJson(value: unknown): CompactProof {
  if (typeof value !== "object" || value === null || !("descriptor" in value) || !("leaves" in value)) {
    throw Error("Missing compact proof fields");
  }
  if (typeof value.descriptor !== "string" || !Array.isArray(value.leaves)) throw Error("Invalid compact proof fields");
  if (value.descriptor.length > 4098 || value.leaves.length > 10000) throw Error("JSON list limit exceeded");
  return {
    descriptor: decodeHex(value.descriptor),
    leaves: value.leaves.map((leaf: unknown) => {
      if (typeof leaf !== "string") throw Error("Invalid leaf encoding");
      return decodeHex(leaf);
    }),
  };
}

export function decodeCompactProofSsz(bytes: Uint8Array): CompactProof {
  if (bytes.length < 8) throw Error("Truncated SSZ offsets");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const leavesOffset = view.getUint32(0, true);
  const descriptorOffset = view.getUint32(4, true);
  if (leavesOffset !== 8 || descriptorOffset < 8 || descriptorOffset > bytes.length) {
    throw Error("Invalid SSZ offsets");
  }
  if ((descriptorOffset - leavesOffset) % 32 !== 0) throw Error("Misaligned SSZ leaves");
  const leafCount = (descriptorOffset - leavesOffset) / 32;
  if (leafCount > 10000 || bytes.length - descriptorOffset > 2048) throw Error("SSZ list limit exceeded");
  return {
    descriptor: bytes.slice(descriptorOffset),
    leaves: Array.from({length: leafCount}, (_, i) => bytes.slice(8 + i * 32, 8 + (i + 1) * 32)),
  };
}

/** Independent implementation of docs/pages/libraries/api/proof-format.md; no SSZ or tree library is used. */
export function reconstructCompactProof({descriptor, leaves}: CompactProof): Map<bigint, Uint8Array> {
  if (descriptor.length === 0 || descriptor.length > 2048) throw Error("Invalid descriptor length");
  if (leaves.length === 0 || leaves.length > 10000) throw Error("Invalid leaf count");
  for (const leaf of leaves) {
    if (leaf.length !== 32) throw Error("Leaf must contain 32 bytes");
  }
  const nodes = new Map<bigint, Uint8Array>();
  const pending = [{gindex: 1n, combine: false}];
  let bit = 0;
  let leaf = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) throw Error("Missing pending node");
    const {gindex, combine} = next;
    if (combine) {
      const left = nodes.get(gindex * 2n);
      const right = nodes.get(gindex * 2n + 1n);
      if (!left || !right) throw Error("Missing child root");
      nodes.set(gindex, createHash("sha256").update(left).update(right).digest());
    } else {
      if (bit >= descriptor.length * 8) throw Error("Incomplete descriptor tree");
      const terminal = (descriptor[Math.floor(bit / 8)] & (0x80 >> (bit % 8))) !== 0;
      bit++;
      if (terminal) {
        if (leaf >= leaves.length) throw Error("Missing proof leaf");
        nodes.set(gindex, leaves[leaf++].slice());
      } else {
        pending.push(
          {gindex, combine: true},
          {gindex: gindex * 2n + 1n, combine: false},
          {gindex: gindex * 2n, combine: false}
        );
      }
    }
  }
  if (leaf !== leaves.length) throw Error("Extra proof leaves");
  if (Math.ceil(bit / 8) !== descriptor.length) throw Error("Extra descriptor bytes");
  for (; bit < descriptor.length * 8; bit++) {
    if ((descriptor[Math.floor(bit / 8)] & (0x80 >> (bit % 8))) !== 0) throw Error("Nonzero descriptor padding");
  }
  return nodes;
}

export function verifyCompactProof(
  proof: CompactProof,
  expectedRoot: Uint8Array,
  targets: ReadonlyMap<bigint, Uint8Array>
): Map<bigint, Uint8Array> {
  const nodes = reconstructCompactProof(proof);
  if (expectedRoot.length !== 32 || !Buffer.from(expectedRoot).equals(nodes.get(1n) ?? new Uint8Array())) {
    throw Error("Unexpected proof root");
  }
  for (const [gindex, expected] of targets) {
    if (gindex < 1n || expected.length !== 32) throw Error("Invalid expected target");
    const actual = nodes.get(gindex);
    if (!actual) throw Error(`Target ${gindex} is not exposed by this proof`);
    if (!Buffer.from(expected).equals(actual)) throw Error(`Unexpected value at target ${gindex}`);
  }
  return nodes;
}
