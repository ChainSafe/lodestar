# Ethereum Specification Verification with ethspecify

This document describes our centralized approach for using ethspecify in the Lodestar codebase to track changes in the Ethereum consensus specifications.

## What is ethspecify?

[ethspecify](https://github.com/jtraglia/ethspecify) is a tool that helps detect changes in the Ethereum consensus specifications. Our centralized approach improves on the traditional method by keeping all specification references in a single file.

## Installation

To use our centralized ethspecify approach, you need to install ethspecify in a Python virtual environment:

```bash
# Create a virtual environment
python3 -m venv ethspecify_env

# Activate the virtual environment
source ethspecify_env/bin/activate

# Install ethspecify
pip install ethspecify
```

## Centralized Approach for ethspecify Tags

Instead of scattering ethspecify tags throughout our codebase, we use a centralized approach that keeps all specification references in a single file. This makes maintenance much easier when specifications change.

### How It Works

1. All specification references are stored in a single file: `spec-references.ts`
2. A wrapper script (`run-ethspecify.js`) processes these references and runs ethspecify
3. No inline ethspecify tags are needed in the actual code files

### The Centralized References File

Our `spec-references.ts` file contains all the specification references in a structured format:

```typescript
/**
 * CENTRALIZED ETHSPECIFY TAGS
 * 
 * This file maps Lodestar code components to Ethereum specification references.
 * No markers or comments are needed in the actual implementation files.
 */

export const SpecReferences = [
  // Preset Variables
  {
    component: "SLOTS_PER_EPOCH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec preset_var="SLOTS_PER_EPOCH" fork="deneb" style="hash" hash="cb41af43" />`
  },
  
  // Constants
  {
    component: "GENESIS_SLOT",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="GENESIS_SLOT" fork="deneb" style="hash" hash="2d6f8884" />`
  },
  
  // Functions
  {
    component: "process_epoch",
    filePath: "packages/state-transition/src/epoch/index.ts",
    specTag: `<spec fn="process_epoch" fork="deneb" style="hash" hash="5fb03e76" />`
  },
  
  // SSZ Objects
  {
    component: "BeaconState",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" fork="deneb" style="hash" hash="2c98ea31" />`
  },
  
  // Custom Types
  {
    component: "Slot",
    filePath: "packages/types/src/primitive/types.ts",
    specTag: `<spec custom_type="Slot" fork="deneb" style="hash" hash="3e079f92" />`
  },
  
  // Track different forks
  {
    component: "BeaconState_electra",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" fork="electra" style="hash" hash="e4c02e51" />`
  }
];
```

### The Wrapper Script

Our `run-ethspecify.js` script processes the centralized references and runs ethspecify on them:

```javascript
/**
 * Wrapper script for ethspecify
 * 
 * This script:
 * 1. Reads the centralized spec references from spec-references.ts
 * 2. Generates a temporary HTML file containing all the spec tags
 * 3. Runs ethspecify on this HTML file
 * 4. Processes and displays the results
 * 5. Cleans up the temporary file
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Extract the SpecReferences array from the file
// Create a temporary HTML file with all the spec tags
// Run ethspecify on the temporary file
// Display the results and clean up
```

## Running the Centralized ethspecify Check

To check for specification changes using our centralized approach:

```bash
node run-ethspecify.js
```

This will:

1. Process all specification references in `spec-references.ts`
2. Run ethspecify to verify them against the latest Ethereum specifications
3. Show updated hash values for any components that have changed

## Supported Tag Types

- `fn`: Functions defined in the Ethereum spec
- `preset_var`: Preset variables defined in the Ethereum spec
- `constant_var`: Constants defined in the Ethereum spec
- `ssz_object`: SSZ container objects defined in the Ethereum spec
- `custom_type`: Custom types defined in the Ethereum spec
- `dataclass`: Dataclasses defined in the Ethereum spec

## Tag Attributes

- `fork`: The fork name (e.g., "deneb", "electra", etc.)
- `preset`: The preset name (e.g., "mainnet", "minimal")
- `style`: The display style ("hash", "full", "diff", or "link")
- `hash`: The hash of the specification content (automatically updated by ethspecify)
- `lines`: For functions, which lines to display (e.g., "5-9" or "7")

## Troubleshooting

If you encounter issues with the centralized ethspecify approach:

1. Ensure the Python virtual environment is properly set up (`ethspecify_env`)
2. Check that the path to the temp directory in `run-ethspecify.js` doesn't contain spaces or special characters
3. Verify that you have the latest version of ethspecify installed
4. Make sure all components in `spec-references.ts` have the correct specification names
5. If you get parsing errors, check the format of the spec tags in `spec-references.ts`

## Reference

For more information on ethspecify, see the [ethspecify documentation](https://github.com/jtraglia/ethspecify).

For details on our implementation, refer to the `spec-references.ts` and `run-ethspecify.js` files in the root directory.
