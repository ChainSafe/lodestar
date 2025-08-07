# SSZ Quickstart Guide

**SSZ** (Simple Serialize) is a standard(serialization format) used in the Ethereum consensus layer(beacon chain) to serialize and Merkleize structured data. It is used heavily in Ethereum 2.0 (the consensus layer) to serialize and Merkleize data structures such as blocks, validator records, the beacon state, and data used in light client proofs. It is the official serialization and Merkleization format used in Ethereum 2.0 (now Ethereum consensus layer).

[*SSZ*](https://github.com/ChainSafe/ssz/tree/master/packages/ssz) provides a standardized way to:
-  **Serialize** structured data into bytes (for storage or transmission)
-  **Merkleize** that data into a secure hash (Merkle root) for validation and proofs

---

## 1.🔍 Why Does SSZ Exist?

Ethereum needs to:
- Efficiently communicate large, complex data structures between nodes
- Ensure data is processed in a **deterministic**, **lightweight**, and **secure** way
- Enable **compact Merkle proofs** so that nodes can verify parts of the data without needing the full structure

SSZ helps by:
- Using a simple and predictable binary format
- Supporting static typing (like in TypeScript or Rust)
- Making Merkle root generation and verification fast and consistent

---
## 2.🛠️ What Does SSZ Do?

 SSZ = Serialization + Merkleization

| Part            | Description                                                                 |
|-----------------|-----------------------------------------------------------------------------|
|  **Serialization**   | It is the process of converting data into a format that can be stored , transmitted and later restructured. Turning structured data (like a block, validator, or state object) into a sequence of bytes so it can be stored, sent over the network, or hashed.  |
|  **Deserialization** |This is the reverse of serialization. You turn the data back into a usable project. Reconstructs the original structured data from the serialized byte array. |
|  **Merkleization**    | This is the process of turning a list of data into a merkle tree. You Buil a Merkle tree from the data and computes a single 32-byte Merkle root (hash) that summarizes it. |

Simpler defination: Serialization: Turn object → bytes, Deserialization: Turn bytes → object, Merkleization: Turn object → tree of hashes → 1 final secure root

---
## 3. SSZ Components in Detail

The Simple Serialize(SSZ) system has two layers of components.
- *Fork Specific Schemas* : Ethereum upgrades (eg. Altair, Bellatrix) They define new structures using the core types.
- *Core SSZ types* :This is a set of composite types used to define data Structures.


This section will break down the different layers of components so you understand how SSZ is used in Lodestar and Ethereum consensus. Understanding this components help in grasping how SSZ transforms structured data into merkle-friendly format for ethereum consensus.
--
## 3.1. Fork-Specific Schemas
Ethereum upgrades like Phase0, Altair, Bellatrix, Capella, etc., introduce new data structures that reflect changes in the protocol.

These schemas are defined using the core SSZ types.
For example: BeaconBlock, Attestation, Validator in Phase0, SyncCommittee in Altair, ExecutionPayload in Bellatrix
Each of these is structured using Containers, Lists, Bitlists, etc., and lives in its own directory in the Lodestar codebase:
/src/phase0, /src/altair, /src/bellatrix, and so on.

---
## 3.2. Core SSZ types
### 3.2.1 Consonants
*SSZ* uses a few constants to standardize Serialization and merkleization.
| Constant                  | Value | Description                                 |
| ------------------------- | ----- | ------------------------------------------- |
| `BYTES_PER_CHUNK`         | 32    | Size of each Merkle tree leaf (in bytes)    |
| `BITS_PER_BYTE`           | 8     | Number of bits in a byte                    |
| `BYTES_PER_LENGTH_OFFSET` | 4     | Bytes used to store variable-length offsets |

These constants ensure compatibility across implementations and define how data is packed and hashed.

### 3.2.2 Typing System
###  Core SSZ Types.
This are the *building blocks* of all SSZ structures.They fall into two types/categories. Primitive types and composite types.

#### Primitive types(Basic types)
These types represent single, atomic values and have a fixed size in bytes. They are the building blocks of all other types.
| Type     | Description                                          | Example              |
|----------|------------------------------------------------------|----------------------|
| boolean  | A single byte, true or false                         | Serialized as 0x00 or 0x01 |
| uintN    | Unsigned Integers: uint8, uint16, ..., up to uint256 | uint64 = 8 bytes     |
| bytesN   | Fixed-length byte arrays, e.g. bytes4, bytes32       | bytes32 = 32 bytes   |


Basic types are always a fixed size and will always occupy the same number of bytes.

#### Composite types
Composite types are constructed by combining other types(basic or composite).They represent structured or grouped data and may be fixed or variable size, depending on their contents.

| Type               | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `Container`        | Like a struct: named fields with different types                           |
| `Vector[T, N]`     | Fixed-length array of N elements of type T                                 |
| `List[T, N]`       | Variable-length array with maximum N elements                              |
| `Bitvector[N]`     | Fixed-length array of bits (booleans) — serialized compactly               |
| `Bitlist[N]`       | Variable-length array of bits, up to N bits — with special length encoding |
| `Union[T0, T1...]` | Holds one of several possible types, along with an index/selector byte     |

Composite types enable grouping of data which is very important on ethereum. Ethereum uses containers, lists, and bitvectors extensively for organizing consensus messages (e.g., BeaconBlock, Attestation, SyncCommittee).

Tip: Any type that includes a List, Bitlist, or Union (or contains them nested) becomes variable-sized.

#### Type Aliases
To make SSZ more readable, common type aliases are used:
| Alias           | Equivalent SSZ Type |
| --------------- | ------------------- |
| `bit`           | `boolean`           |
| `BytesN`        | `Vector[byte, N]`   |
| `ByteList[N]`   | `List[byte, N]`     |
| `ByteVector[N]` | `Vector[byte, N]`   |

These aliases don't change the encoding — they’re just semantic conveniences.

#### Real World Example
Defining a validator container using SSZ.

```
type Validator = Container({
  pubkey: ByteVector[48],
  withdrawal_credentials: Bytes32,
  effective_balance: uint64,
  slashed: boolean,
  activation_eligibility_epoch: uint64,
  activation_epoch: uint64,
  exit_epoch: uint64,
  withdrawable_epoch: uint64
});
```
The whole structure is fixed-size — so it’s encoded without any offsets.

#### Summary
| Concept             | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| **Basic Types**     | Atomic, fixed-size values like numbers and booleans      |
| **Composite Types** | Structs, arrays, or complex types made from other types  |
| **Fixed-Size**      | Known size — no offset metadata needed                   |
| **Variable-Size**   | Dynamic size — needs offset and/or length bytes          |
| **Type Aliases**    | Shorthand notations for common composite types           |
| **Constants**       | Internal SSZ rules for byte/bit sizing and Merkleization |

To learn more about lodestar types go to this repository - [ ChainSafe/Lodestar](https://github.com/ChainSafe/lodestar/tree/unstable/packages/types)
---

## 4. Working with Default values
In this section we will intoduce how to generate SSZ objects with default (zero-initialized) values, explain how to modify them, and demonstrate how TypeScript ensures type-safe interaction.

### What is a default Value?
In SSZ, a default value is an object where all fields are initialized to their zero-equivalent values.
Assuming a helper function default(type) which returns the default value for type, we can recursively define the default value for all types.

This is useful when:
-You want to create new SSZ data from scratch.
-You’re preparing data to be filled step-by-step.
-You want to ensure consistency with SSZ schemas

Each schema (like Attestation, BeaconBlock, etc.) provides a defaultValue() method to create such an object.

Here is a table of the different types and their default values.

|Type	|Default Value|
|uintN|	0|
|boolean|	False|
|Container|	[default(type) for type in container]|
|Vector[type, N]|	[default(type)] * N|
|Bitvector[N]|	[False] * N|
|List[type, N]	|[]|
|Bitlist[N]	|[]|
|Union[type_0, type_1, ...]	|default(type_0)|

is_zero
An SSZ object is called zeroed (and thus, is_zero(object) returns true) if it is equal to the default value for that type.