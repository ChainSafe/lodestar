# Lodestar Types Documentation & Examples

This repository provides **learning resources and runnable examples** for working with [SSZ (Simple Serialize)](https://github.com/ethereum/consensus-specs/tree/dev/ssz) in TypeScript.  
It is designed for Ethereum developers, researchers, and contributors working with the Lodestar consensus client, but also useful for anyone learning SSZ.

---

## 📁 Structure
```

ssz-docs/
├─ ssz-quickstart.md
├─ ssz-views-and-proofs.md
├─ ssz-examples.md
└─ ...
 ```

---

### Overview

- **`ssz-quickstart.md`** — Beginner-friendly guide to SSZ. Learn serialization, deserialization, and `hashTreeRoot`.
- **`ssz-views-and-proofs.md`** — Advanced guide on SSZ views, Merkle proofs, and efficient data access.
- **`ssz-examples.md`** — Runnable **TypeScript demos** that complement the docs.

This documentation serves as a **quick reference and tutorial set** for Lodestar contributors, client developers, and researchers exploring the SSZ type system.

---

## 📘 Documentation

### **1. `ssz-quickstart.md`**
- Covers primitive types (`uint64`), containers, lists, and vectors.  
- Explains **serialization**, **deserialization**, and **hashing** (`hashTreeRoot`).  
- Includes **JSON conversion** (`toJson`, `fromJson`) for API use.  
- Ideal starting point for newcomers.

### **2. `ssz-views-and-proofs.md`**
- Explains **tree-backed views** for efficient, mutable access.  
- Demonstrates how to **generate and verify Merkle proofs**.  
- Covers **light client use cases**, and **nested data access**.  
- Recommended after completing the quickstart.

### **3. `ssz-examples.md`**
- Runnable **TypeScript demos** that complement the docs.
- Ideal for beginners who want to test ou different concepts in the SSZ.

---

## 💻 Running the Examples

The `examples` are in the ssz-examples.md,  contains runnable **TypeScript demos** that match the topics covered in the docs.  
Each example is self-contained and can be run directly with `ts-node`.

### **Setup**
```bash
npm install
# or, directly:
npm install @chainsafe/ssz @lodestar/types typescript ts-node
```
Run an Example: 
Pick an example from the file and transfer it in you it's own file eg. Container.ts  then run the file with the following command.

```
npx ts-node examples/simple-container.ts

```

Example Explained
1. simple-container

Defines a basic SSZ container with primitive fields (e.g. uint64).

Demonstrates:
`serialize()` — convert container to SSZ bytes
`deserialize()` — parse bytes back into structured data
Useful for: learning container patterns and core SSZ workflow.

2. nested-container

Shows how containers can contain other containers.
Demonstrates:
Serialization and deserialization of nested structures
Useful for: building real-world Ethereum objects (validators, blocks, etc.).

3. lists-vectors.ts
Introduces SSZ lists (variable-length) and vectors (fixed-length).

Demonstrates:
Creating dynamic lists
Enforcing fixed-size vectors
Serializing both forms
Useful for: handling validator lists, committees, or signatures in consensus types.

FInd more examples in the ssz-examples files.

## 📘 Learn More

### Resources

[Further Reading](https://ethereum.org/developers/docs/data-structures-and-encoding/ssz/)
[Building blocks ssz](https://eth2book.info/altair/part2/building_blocks/ssz/)
[merkle multiproofs](https://github.com/ethereum/consensus-specs/blob/dev/ssz/merkle-proofs.md#merkle-multiproofs)
[simple serialize](https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md)
[Lodestar types](https://github.com/ChainSafe/lodestar/tree/unstable/packages/types)

