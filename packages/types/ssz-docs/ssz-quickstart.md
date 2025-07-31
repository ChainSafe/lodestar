# SSZ Quickstart Guide

**SSZ** (Simple Serialize) is a standard(serialization format) used in the Ethereum consensus layer(beacon chain) to serialize and Merkleize structured data. It is used heavily in Ethereum 2.0 (the consensus layer) to serialize and Merkleize data structures such as blocks, validator records, the beacon state, and data used in light client proofs. It is the official serialization and Merkleization format used in Ethereum 2.0 (now Ethereum consensus layer).

[*SSZ*](https://github.com/ChainSafe/ssz/tree/master/packages/ssz) provides a standardized way to:
-  **Serialize** structured data into bytes (for storage or transmission)
-  **Merkleize** that data into a secure hash (Merkle root) for validation and proofs

---

## 🔍 Why Does SSZ Exist?

Ethereum needs to:
- Efficiently communicate large, complex data structures between nodes
- Ensure data is processed in a **deterministic**, **lightweight**, and **secure** way
- Enable **compact Merkle proofs** so that nodes can verify parts of the data without needing the full structure

SSZ helps by:
- Using a simple and predictable binary format
- Supporting static typing (like in TypeScript or Rust)
- Making Merkle root generation and verification fast and consistent

---
## 🛠️ What Does SSZ Do?

 SSZ = Serialization + Merkleization

| Part            | Description                                                                 |
|-----------------|-----------------------------------------------------------------------------|
|  **Serialization**   | It is the process of converting data into a format that can be stored , transmitted and later restructured. Turning structured data (like a block, validator, or state object) into a sequence of bytes so it can be stored, sent over the network, or hashed.  |
|  **Deserialization** |This is the reverse of serialization. You turn the data back into a usable project. Reconstructs the original structured data from the serialized byte array. |
|  **Merkleization**    | This is the process of turning a list of data into a merkle tree. You Buil a Merkle tree from the data and computes a single 32-byte Merkle root (hash) that summarizes it. |

Simpler defination: Serialization: Turn object → bytes, Deserialization: Turn bytes → object, Merkleization: Turn object → tree of hashes → 1 final secure root

---
## SSZ Components in Detail

The Simple Serialize(SSZ) system has two layers of components.
- *Core SSZ types* :This is a set of composite types used to define data Structures.
- *Fork Specific Schemas* : Ethereum upgrades (eg. Altair, Bellatrix) They define new structures using the core types.

This section will break down the different layers of components so you understand how SSZ is used in Lodestar and Ethereum consensus. Understanding this components help in grasping how SSZ transforms structured data into merkle-friendly format for ethereum consensus.
 
### Core SSZ Types.
This are the *building blocks* of all SSZ structures.They fall into two types/categories. Primitive types and composite types.

|Type                    | Description                      |
|------------------------|--------------------------------- |
|boolean        | A single byte  |
|uintN         | Unsigned Integers: uint8, uint16, uint32.....upto uint256 |
|bytesN        | fixed length byte arrays eg. byte4, bytes32   |