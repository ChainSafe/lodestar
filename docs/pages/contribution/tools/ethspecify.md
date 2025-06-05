---
id: ethspecify
title: Ethspecify
---

# Ethereum Specification Verification with Ethspecify

This document describes our centralized approach for using ethspecify in the Lodestar codebase to track changes in the Ethereum consensus specifications.

## What is Ethspecify?

[Ethspecify](https://github.com/jtraglia/ethspecify) is a tool that helps detect changes in the Ethereum consensus specifications. Our centralized approach improves on the traditional method by keeping all specification references in a single file.

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

Our `spec-references.ts` file contains all the specification references in a structured format. For the complete implementation and examples, see the `spec-references.ts` file in the `configs` directory.

### The Wrapper Script

Our `run-ethspecify.js` script processes the centralized references and runs ethspecify on them. For implementation details, see the script file at `scripts/run-ethspecify.js`.

## @spec Tag System

We use custom `@spec` tags in JSDoc comments to link specification references to their implementations:

```typescript
/**
 * @spec process_epoch
 */
{
  component: "process_epoch",
  filePath: "packages/state-transition/src/epoch/index.ts",
  specTag: `<spec fn="process_epoch" hash="771a9cad" />`
}
```

### Key Features

1. **Searchability**: Globally search `@spec COMPONENT_NAME` to find references
2. **No Line Numbers**: Resilient to code changes
3. **Validation**: The `run-ethspecify.js` script verifies all components have tags
4. **IDE Neutral**: Works consistently across all development environments

### Usage

1. Add `@spec COMPONENT_NAME` above each reference in `spec-references.ts`
2. When investigating a component, search for its `@spec` tag
3. The validation script will flag any missing tags during execution

## Running the Centralized ethspecify Check

To check for specification changes using our centralized approach:

```bash
node scripts/run-ethspecify.js
```

This will:

1. Process all specification references in `spec-references.ts`
2. Run ethspecify to verify them against the latest Ethereum specifications
3. Show updated hash values for any components that have changed

## Benefits of the Centralized Approach

1. **Clean Codebase**: No ethspecify tags scattered throughout code files
2. **Easier Maintenance**: Update all references in one place when specifications change
3. **Better Organization**: Group references logically by component type
4. **Improved Tracking**: Easily see which components need updates when new forks are released
5. **Versioning**: Keep the reference file in version control to track spec evolution

## Current Features

1. **Centralized References**: All spec tags in one file
2. **Automated Validation**: Checks for missing `@spec` tags
3. **Hash Verification**: Confirms spec references are up-to-date

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

## Troubleshooting

If you encounter issues with the centralized ethspecify approach:

1. Ensure the Python virtual environment is properly set up (`ethspecify_env`)
2. Check that the path to the temp directory in `run-ethspecify.js` doesn't contain spaces or special characters
3. Verify that you have the latest version of ethspecify installed
4. Make sure all components in `spec-references.ts` have the correct specification names
5. If you get parsing errors, check the format of the spec tags in `spec-references.ts`

## Reference

For more information on ethspecify, see the [ethspecify documentation](https://github.com/jtraglia/ethspecify).

For details on our implementation, refer to the `configs/spec-references.ts` and `scripts/run-ethspecify.js` files.
