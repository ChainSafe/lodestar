# SSZ Quickstart Guide

# Table of content
1. [🔍 Why Does SSZ Exist?](#1🔍-why-does-ssz-exist)
2. [🛠️ What Does SSZ Do?](#2🛠️-what-does-ssz-do)
3. [SSZ Components in Detail](#3-ssz-components-in-detail)
   - [Fork-Specific Schemas](#31-fork-specific-schemas)
   - [Core SSZ Types](#32-core-ssz-types)
     - [Constants](#321-consonants)
     - [Typing System](#322-typing-system)
     - [Primitive Types](#primitive-typesbasic-types)
     - [Composite Types](#composite-types)
     - [Type Aliases](#type-aliases)
4. [Core SSZ Workflows](#4-core-ssz-workflows-in-lodestar)
   -[Working with default Values](#working-with-default-values)
   -[Typescript Safety with Lodestar Librar](#typescript-safety-with-lodestar-ssz-library)
   -[Serializantion and deserialization](#serialization-and-deserialization)
   -[Merkleization and Hashing](#merkleization-and-Hashing)
   -[JSON Conversion in SSZ](#JSON-Conversion-in-SSZ)

**SSZ** (Simple Serialize) is a standard(serialization format) used in the Ethereum consensus layer(beacon chain) to serialize and Merkleize structured data. It is heavily used in Ethereum 2.0 (the consensus layer) to serialize and Merkleize data structures such as blocks, validator records, the beacon state, and data used in light client proofs. It is the official serialization and Merkleization format used in Ethereum 2.0 (now Ethereum consensus layer).

[_SSZ_](https://github.com/ChainSafe/ssz/tree/master/packages/ssz) provides a standardized way to:

- **Serialize** structured data into bytes (for storage or transmission)
- **Merkleize** that data into a secure hash (Merkle root) for validation and proofs

## 1.🔍 Why Does SSZ Exist?

Ethereum needs to:

- Efficiently communicate large, complex data structures between nodes
- Ensure data is processed in a **deterministic**, **lightweight**, and **secure** way
- Enable **compact Merkle proofs** so that nodes can verify parts of the data without needing the full structure

SSZ helps by:

- Using a simple and predictable binary format
- Supporting static typing (like in TypeScript or Rust)
- Making Merkle root generation and verification fast and consistent


## 2.🛠️ What Does SSZ Do?

SSZ = Serialization + Merkleization

| Part                | Description                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Serialization**   | It is the process of converting data into a format that can be stored , transmitted and later restructured. Turning structured data (like a block, validator, or state object) into a sequence of bytes so it can be stored, sent over the network, or hashed. |
| **Deserialization** | This is the reverse of serialization. You turn the data back into a usable project. Reconstructs the original structured data from the serialized byte array.                                                                                                  |
| **Merkleization**   | This is the process of turning a list of data into a merkle tree. You Buil a Merkle tree from the data and computes a single 32-byte Merkle root (hash) that summarizes it.                                                                                    |

Simpler defination: Serialization: Turn object → bytes, Deserialization: Turn bytes → object, Merkleization: Turn object → tree of hashes → 1 final secure root



## 3. SSZ Components in Detail

The **Simple Serialize (SSZ)** system has two main layers of components:

- **Fork-Specific Schemas** — Defined for each Ethereum upgrade (e.g., Altair, Bellatrix, Capella)
- **Core SSZ Types** — A set of fundamental composite types used to define data structures

This section explains how SSZ components are structured in **Lodestar** and the **Ethereum consensus layer**.  
Understanding these helps you grasp how SSZ transforms structured data into **Merkle-friendly formats**.

---

### 3.1 Fork-Specific Schemas

Ethereum upgrades such as **Phase0**, **Altair**, **Bellatrix**, and **Capella** introduce new data structures reflecting protocol changes.

These schemas are **defined using the core SSZ types**.  
Examples include:

- **Phase0** → `BeaconBlock`, `Attestation`, `Validator`  
- **Altair** → `SyncCommittee`  
- **Bellatrix** → `ExecutionPayload`

Each schema is organized in its own Lodestar directory:
/src/phase0
/src/altair


### 3.2. Core SSZ types

#### 3.2.1 Consonants

_SSZ_ uses a few constants to standardize Serialization and merkleization.
| Constant | Value | Description |
| ------------------------- | ----- | ------------------------------------------- |
| `BYTES_PER_CHUNK` | 32 | Size of each Merkle tree leaf (in bytes) |
| `BITS_PER_BYTE` | 8 | Number of bits in a byte |
| `BYTES_PER_LENGTH_OFFSET` | 4 | Bytes used to store variable-length offsets |

These constants ensure compatibility across implementations and define how data is packed and hashed.

#### 3.2.2 Typing System

### Core SSZ Types.

This are the _building blocks_ of all SSZ structures.They fall into two types/categories. Primitive types and composite types.

#### Primitive types(Basic types)

These types represent single, atomic values and have a fixed size in bytes. They are the building blocks of all other types.
| Type | Description | Example |
|----------|------------------------------------------------------|----------------------|
| boolean | A single byte, true or false | Serialized as 0x00 or 0x01 |
| uintN | Unsigned Integers: uint8, uint16, ..., up to uint256 | uint64 = 8 bytes |
| bytesN | Fixed-length byte arrays, e.g. bytes4, bytes32 | bytes32 = 32 bytes |

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
| Alias | Equivalent SSZ Type |
| --------------- | ------------------- |
| `bit` | `boolean` |
| `BytesN` | `Vector[byte, N]` |
| `ByteList[N]` | `List[byte, N]` |
| `ByteVector[N]` | `Vector[byte, N]` |

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

## To learn more about lodestar types go to this repository - [ ChainSafe/Lodestar](https://github.com/ChainSafe/lodestar/tree/unstable/packages/types)

---

## 4. Core SSZ Workflows in Lodestar
Before we dive into advanced operations like Views, Proofs, and Tree Handling, let’s look at the core workflows — creating, serializing, merkleizing, and converting data.

### Working with Default values

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

| Type                       | Default Value                         |
| -------------------------- | ------------------------------------- |
| uintN                      | 0                                     |
| boolean                    | False                                 |
| Container                  | [default(type) for type in container] |
| Vector[type, N]            | [default(type)] \* N                  |
| Bitvector[N]               | [False] \* N                          |
| List[type, N]              | []                                    |
| Bitlist[N]                 | []                                    |
| Union[type_0, type_1, ...] | default(type_0)                       |

is_zero
An SSZ object is called zeroed (and thus, is_zero(object) returns true) if it is equal to the default value for that type.

### How to use default value()

You can create a default object like so:

```
import { ssz} from "@lpdestar/types";

//Creating an SSZ Phase0 Attestation with all fields zero-initialized
const attestation = ssz.phase0.Attestation.defultValue();

```

The Attestation object now looks something like this:

```
{
  aggregationBits: Uint8Array[],
  data: {
    slot: 0,
    index: 0,
    source: {
      epoch: 0,
      root: Uint8Array(32)
    },
    ...
  },
  signature: Uint8Array(96)
}
```

In our example above we use the _Attestation_ schema as an example - It is a common data structure in Ethereum consesus, representing a validators signed vote.

```

NB// an attestation is a validator’s vote about the state of the blockchain at a specific time (slot).
It includes:
-Which block the validator thinks should be the head of the chain.
-Which epoch checkpoints they agree on.
-A cryptographic signature to prove it’s from them.

Attestations are bundled together and included in new blocks to help the network agree on the canonical.
```

### Setting Values in your Attestation object

Once you have a default object, you can update it's values directly:

```
attestation.data.source.epoch = 100;
attestation.data.target.epoch = 200;
```

You can also modify primitive values like numbers, boolean, bigint easilly:

```
attestation.data.slot = 123456;
attestation.aggregationBits = new Uint8Array([1, 0, 1]);
```

### TypeScript Safety with Lodestar SSZ Library.

One of the biggest advantages of using Lodestar’s SSZ library in TypeScript is its strong type safety.
Ethereum’s data structures (like Attestation, Block, or Validator) are deeply nested and have strict formats — TypeScript + Lodestar ensures you can work with them without guessing field names or data types.

#### What Type Safety Means Here

It has compiler checks that ensure values match expected types.
When we say “TypeScript safety,” we mean:
-Correct types only – you cannot assign a wrong type to a field.
-Autocomplete support – your IDE (e.g., VSCode) can suggest valid field names and their types.
-Compile-time error checking – mistakes are caught before you run the code.
-Confidence when refactoring – if a field changes, TypeScript will highlight every affected place.
-It has compiler checks that ensure values match expected types.

#### How Lodestar Enhances TYpescript Safety

The Lodestar SSZ library:

-Ships with predefined TypeScript interfaces for all Ethereum consensus types.
-Links these interfaces directly to SSZ serialization/deserialization methods.
-Enforces nested type correctness — even inside deeply nested objects like attestation.data.source.epoch.

For example:

```

import { ssz } from "@lodestar/types";

// Create a zero-initialized attestation
const attestation = ssz.phase0.Attestation.defaultValue();

// Autocomplete works for deeply nested fields
attestation.data.source.epoch = 100;

//  Type error: Trying to assign a string where a number is expected
attestation.data.source.epoch = "100";
// Error: Type 'string' is not assignable to type 'number'

//  Correct way to set the signature (96-byte array)
attestation.signature = new Uint8Array(96);

// Wrong type: TypeScript will reject this immediately
attestation.signature = "0xabc";
// Error: Type 'string' is not assignable to type 'Uint8Array'

```

This is is important for _Ethereum_ Development.
Ethereum SSZ structures have very precise rules, some fields have fixed-length bytes arrays(eg. Uint8Array(96) for the signatures), some will have different sizes etc.
Without type safety, it is easy to Assign a wrong-sized array, mistype a field name, pass data in the wrong format hence breakinf serialization.

Lodestar + TypeScript ensures these mistakes never make it to runtime — they’re caught instantly in your editor.

### Lodestar SSZ Type Safety Flow

```
      ┌────────────────────┐
      │ Ethereum Spec Types │
      │ (Phase0, Altair...) │
      └─────────┬──────────┘
                │
                ▼
      ┌───────────────────────┐
      │ Lodestar TypeScript    │
      │ Interfaces             │
      │ e.g. Attestation, Block│
      └─────────┬─────────────┘
                │
                ▼
      ┌───────────────────────┐
      │ Lodestar SSZ Schema    │
      │ (Serialization rules)  │
      └─────────┬─────────────┘
                │
                ▼
      ┌───────────────────────┐
      │ TypeScript Compiler    │
      │ (Type Checking,        │
      │ Autocomplete, Errors)  │
      └─────────┬─────────────┘
                │
                ▼
      ┌───────────────────────┐
      │ Developer Experience   │
      │ • Correct types only   │
      │ • Auto-complete        │
      │ • Early bug detection  │
      └───────────────────────┘

```

#### How to read the above diagram

1. Ethereum Spec Types → Definitions from the Ethereum consensus spec (Phase0, Altair, Bellatrix, etc.).
2. Lodestar TypeScript Interfaces → These will mirror the spec but in TypeScript form.
3. SSZ Schema → Maps each interface to its SSZ serialization/deserialization rules.
4. TypeScript Compiler → Enforces correctness at compile-time.
5. Developer Experience → What you benefit from (type correctness, autocomplete, no silent runtime bugs).

---

### Serialization and Deserialization
SSZ provides serialize() to turn a value into bytes and deserialize() to restore it. Both follow Ethereum’s standardized format so all clients produce identical results.

We recursively define the serialize function which consumes an object value (of the type specified) and returns a bytestring of type bytes. To learn more about the different type bytes go here. [SimpleSerialize.md](https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md)

Example: 
```
const serialized = ssz.phase0.Attestation.serialize(attestation);
console.log(serialized); // Uint8Array([...])
```
Here, serialized is a Uint8Array — a compact binary representation of your object.

#### What is Deserialization?
Deserialization is the reverse process — it converts a byte array back into the original structured object.

example:
```
const attestation2 = ssz.phase0.Attestation.deserialize(serialized);
console.log(attestation2); // Object same as the original

```
#### Why Do We Need This in Ethereum?
In Ethereum consensus:

-Blocks, attestations, and other state objects are sent over the network as bytes.
-Nodes serialize before sending and deserialize when receiving to reconstruct the exact original structure.
-SSZ ensures the process is consistent across all clients.

#### Full Round example
```
import { ssz } from "@lodestar/types";

// Step 1: Create default attestation
const attestation = ssz.phase0.Attestation.defaultValue();
attestation.data.source.epoch = 100;

// Step 2: Serialize → Uint8Array
const serialized = ssz.phase0.Attestation.serialize(attestation);
console.log("Serialized bytes:", serialized);

// Step 3: Deserialize → Object
const attestation2 = ssz.phase0.Attestation.deserialize(serialized);

// Step 4: Verify equality
console.log(
  "Equal?",
  ssz.phase0.Attestation.equals(attestation, attestation2) // true
);
```

Tip: Serialization in SSZ is not JSON serialization — it’s binary, so the result is not human-readable.
If you want a JSON-friendly format, use:
```
const json = ssz.phase0.Attestation.toJson(attestation);
const fromJson = ssz.phase0.Attestation.fromJson(json);
```
To understand how Lodestar’s SSZ library implements serialization and deserialization. Read this article [Under the Hood: How serialize() and deserialize() Work in Lodestar]()
---

### Merkleization and Hashing
In SSZ every object can be turned into a Merkle root — a single 32-byte hash that represents the entire structure.Hashing and Merkleization are the heart of SSZ because they’re what make consensus proofs possible. 

#### What is Hashing?
Hashing turns data of any size into a fixed-size digest.

- Function used: SHA-256 (always outputs 32 bytes).
- Deterministic: same input → same output.
- Secure: infeasible to reverse or find collisions.

Example:
```
sha256("hello") 
= 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824

```

#### What is Merkleization?

-[ Merkleization ](https://www.investopedia.com/terms/m/merkle-tree.asp) is process of hashing SSZ objects into a binary Merkle tree.
- Each field → a leaf node.
- The tree’s root hash = Merkle root → uniquely represents the entire object.
- This is what Ethereum consensus uses for proofs and state commitments.

#### How Merkleization Works?
1. Serialize values into fixed-size 32-byte chunks.
   Example: a uint64 (8 bytes) → padded to 32 bytes.

2. Hash the  leaves:
Each 32-byte chunk is considered a Merkle leaf. (What you got after serialization)

3. Pairwise hashing:

Concatenate two 32-byte nodes (64 bytes).

Hash them with SHA-256 → 32-byte parent.
```
H(left || right) → parent
```
4. Repeat until root:

Continue combining until a single 32-byte Merkle root remains.
NB// The root is the merkle roots. Merkle roots are stored in block headers, they prove contents of the entire block.

To learn more about merkleization read this article. 
[ Merkleization simplified ](https://www.investopedia.com/terms/m/merkle-tree.asp)

Example:  Merkleizing a simple number with no siblings just the root.
```
import { ssz } from "@lodestar/types";

const num = 5n;
const root = ssz.uint64.hashTreeRoot(num);

console.log(root.toString("hex"));
// e.g. 8c0f... (32-byte Merkle root)

```
---
### JSON Conversion in SSZ
### Why JSON?
- SSZ is a binary serialization format, optimized for hashing and Merkle proofs.
- But APIs, config files, and REST/GraphQL endpoints typically use JSON.
- To bridge the two, SSZ types expose helper functions for converting to/from JSON.

#### 1. Encoding to JSON.
Every SSZ type has the following:
```
const jsonValue = SomeSSZType.toJson(sszObject);
```
- Converts SSZ binary-friendly objects into JSON-serializable values.
- Byte arrays (Uint8Array) become hex strings (human-readable).
- Nested containers and lists also convert recursively.

Example:
```
import {ContainerType, ByteVectorType, ValueOf} from "@chainsafe/ssz";

const Keypair = new ContainerType({
  privateKey: new ByteVectorType(32),
  publicKey: new ByteVectorType(48),
});

type Keypair = ValueOf<typeof Keypair>;

const kp: Keypair = Keypair.defaultValue();

// Convert to JSON
const kpJSON = Keypair.toJson(kp);

console.log(kpJSON);
/*
{
  privateKey: "0x0000000000000000000000000000000000000000000000000000000000000000",
  publicKey: "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000"
}
*/
```

#### Decoding from JSON
To convert back from JSON into a usable SSZ object:
```
const kp2 = Keypair.fromJson(kpJSON);
```
fromJson parses hex strings back into Uint8Arrays.

The result is a valid SSZ object, usable with all SSZ functions (serialize, hashTreeRoot, etc.).

It is that simple to convert data from JSON back into a SSZ object.

### JSON + Serialization Pipeline
Here is how JSON interacts with SSZ:
```
JSON <-> (toJson/fromJson) <-> SSZ Object <-> (serialize/deserialize) <-> Binary
```
This allows:

- Storage in JSON (e.g., configs).
- Transmission over REST APIs.
- Interoperability with frontend/backends that don’t handle binary well.

#### Sending a SSZ object over the API
```
// Example API payload
const payload = JSON.stringify(Keypair.toJson(kp));

// Send to API...
fetch("/api/keypair", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: payload,
});

// Receiving side
const parsed = JSON.parse(payload);
const receivedKeypair = Keypair.fromJson(parsed);

// Now it's a valid SSZ object again
console.log(receivedKeypair.privateKey);
```

### JSON Conversion Gotchas
- Always use .toJson and .fromJson instead of JSON.stringify/parse directly on SSZ objects — otherwise Uint8Arrays will break.
- Hex encoding is the standard format for all byte arrays.
- Nested containers and lists are handled automatically — you don’t need to recurse manually.