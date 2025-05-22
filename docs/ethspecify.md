# Ethereum Specification Verification with ethspecify

This document describes how to use ethspecify in the Lodestar codebase to track changes in the Ethereum consensus specifications.

## What is ethspecify?

[ethspecify](https://github.com/jtraglia/ethspecify) is a tool that helps us to:

1. Maintain references to the Ethereum specifications in our code
2. Detect when the specifications change
3. Keep our implementation in sync with the latest specifications

## Installation

ethspecify is a Python tool. You can install it in a virtual environment:

```bash
# Create a virtual environment if it doesn't exist
python3 -m venv .venv

# Activate the virtual environment
source .venv/bin/activate

# Install ethspecify
pip install ethspecify

# Deactivate when done
deactivate
```

Or you can use the provided script:

```bash
./scripts/check-specs.sh
```

## Running ethspecify

You can run ethspecify in two ways:

1. Using the yarn script we added:

```bash
yarn check-specs
```

2. Or directly using the shell script:

```bash
./scripts/check-specs.sh
```

## Adding ethspecify Tags

ethspecify uses HTML-like tags in comments to reference Ethereum specifications. Here are the formats for different types of tags:

### Function Tags

For implementation of spec functions (like state transitions or block processing):

```typescript
/**
 * <spec fn="state_transition" fork="deneb" style="hash" />
 */
function stateTransition(...) {
  // implementation
}
```

### Preset Variable Tags

For preset variables defined in the Ethereum spec:

```typescript
// <spec preset_var="SLOTS_PER_EPOCH" fork="deneb" style="hash" />
const SLOTS_PER_EPOCH = 32;
```

For preset variables with an explicit preset:

```typescript
// <spec preset_var="FIELD_ELEMENTS_PER_BLOB" preset="mainnet" fork="deneb" style="hash" />
const FIELD_ELEMENTS_PER_BLOB = 4096;
```

### Constant Variable Tags

For constant variables defined in the Ethereum spec:

```typescript
// <spec constant_var="DOMAIN_BEACON_PROPOSER" fork="deneb" style="hash" />
const DOMAIN_BEACON_PROPOSER = 0;
```

## Tag Attributes

- `fn`: The function name as defined in the Ethereum spec
- `preset_var`: The preset variable name as defined in the Ethereum spec
- `constant_var`: The constant variable name as defined in the Ethereum spec
- `fork`: The fork name (e.g., "deneb", "capella", "bellatrix", etc.)
- `preset`: The preset name (e.g., "mainnet", "minimal")
- `style`: The style of the tag output (e.g., "hash" for adding hash information)

## Troubleshooting

If ethspecify fails to recognize a tag, check:

1. The attribute type (`fn`, `preset_var`, or `constant_var`)
2. The exact name of the item as defined in the Ethereum spec
3. The fork and preset names

You can check available keys by examining the pyspec.json file that ethspecify uses.
