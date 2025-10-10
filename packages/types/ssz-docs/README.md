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

## 📁 Structure Overview

- **`ssz-quickstart.md`**: A beginner-friendly introduction to working with SSZ — how to serialize, deserialize, and compute `hashTreeRoot`.
- **`ssz-views-and-proofs.md`**: Details advanced usage of SSZ views, how to generate Merkle proofs, and common caveats when accessing nested data.
- **`ssz-Examples.md `**: this file contains runnable **TypeScript demos** that complement the docs.  

---

This documentation is intended as a quick reference and learning tool for new contributors, client developers, and researchers working with Lodestar’s type system.
It is detailed description of the method's purpose, includes working code examples that users can run and tutorials on how to use them.


---

## 📘 Documentation

### **1. `ssz-quickstart.md`**
- Beginner-friendly introduction to SSZ.  
- Covers primitive types (`uint64`), containers, lists, and vectors.  
- Explains serialization, deserialization, hashing (`hashTreeRoot`).  
- Includes **JSON conversion** (`toJson`, `fromJson`) for working with APIs.  
- Best place to start if you’re **new to SSZ in TypeScript**.

### **2. `ssz-views-and-proofs.md`**
- Advanced usage guide.  
- Explains **tree-backed views** (mutable, efficient access to SSZ objects).  
- Covers **Merkle proofs** for light clients and stateless validation.  
- Shows how to combine views, proofs, and JSON conversion.  
- Recommended after you understand the quickstart basics.


---

## 💻 Examples

The `examples/` folder contains runnable **TypeScript demos** that complement the docs.  
Each file is **self-contained** and can be run directly with `ts-node`.  

👉 Use these to **validate what you learned from the docs** and to copy/paste working patterns into your own projects.

### How to run
1. Install dependencies:
   ```bash
   npm install
   # or, directly:
   npm install @chainsafe/ssz @lodestar/types typescript ts-node

Run an Example: 
Pick a file.
```
npx ts-node examples/simple-container.ts
```
## Example Files Explained.
1. simple-container.ts

Defines a basic SSZ container with primitive fields (e.g., uint64).

Demonstrates:

serialize() — convert container to SSZ bytes.

deserialize() — parse bytes back into structured data.

Useful for: learning the container pattern and the core SSZ workflow.

2. nested-container.ts

Shows how containers can contain other containers.

Demonstrates serialization and deserialization of nested structures.

Useful for: building real-world Ethereum objects (validators, blocks, etc.), which are typically deeply nested containers.

3. lists-vectors.ts

Introduces SSZ lists (variable-length) and vectors (fixed-length).

Demonstrates:

Creating lists with dynamic sizes.

Creating vectors with enforced fixed size.

Serializing both forms.

Useful for: handling validator lists, committees, or fixed-size signatures in consensus types.

Find more examples in the examples folder.

## 📘 Learn More

Resources

- [SSZ Quickstart](./ssz-quickstart.md)
- [ Working with SSZ Views & Proofs](./ssz-views-and-proofs.md)
- [Ethereum Consensus Specs]()

