# Lodestar Types Documentation

This folder contains reference and usage documentation for the Lodestar `@lodestar/types` package.

It is structured to help contributors and developers understand how to use and interact with the SSZ (Simple Serialize) types used throughout Ethereum consensus clients, particularly within Lodestar.

## 📁 Structure Overview

- **`ssz-quickstart.md`**: A beginner-friendly introduction to working with SSZ — how to serialize, deserialize, and compute `hashTreeRoot`.
- **`ssz-views-and-proofs.md`**: Details advanced usage of SSZ views, how to generate Merkle proofs, and common caveats when accessing nested data.
- **`phase0/`, `altair/`, `bellatrix/`**: Each fork folder documents important SSZ types defined in that Ethereum consensus phase. Inside are brief summaries and usage tips for critical types like `BeaconBlock`, `Attestation`, `ExecutionPayload`, etc. It also explains what is type is and how it works.

---

This documentation is intended as a quick reference and learning tool for new contributors, client developers, and researchers working with Lodestar’s type system.
It is detailed description of the method's purpose, includes working code examples that users can run and tutorials on how to use them.

## 📘 Learn More

- [SSZ Quickstart](./docs/ssz-quickstart.md)
- [Working with SSZ Views & Proofs](./docs/ssz-views-and-proofs.md)

```bash
docs/
├── ssz-quickstart.md           # Guide to basic SSZ usage
├── ssz-views-and-proofs.md     # Advanced SSZ features
├── phase0/                     # Phase0-specific types
├── altair/                     # Altair-specific types
├── bellatrix/                  # Bellatrix-specific types
├── ...