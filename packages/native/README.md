# @lodestar/native

Native consensus modules for [Lodestar](https://github.com/ChainSafe/lodestar),
implemented in Zig and exposed to Node.js through NAPI bindings.

## Installation

```sh
pnpm add @lodestar/native
```

The wrapper and its platform packages use the same version as the Lodestar monorepo.
Published packages include binaries for Linux (glibc and musl) and macOS, on x64 and arm64.

## Development

The Zig sources and build files live at the repository root. From that root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:native
```

For native-only changes, rebuild with `pnpm build:native`. The output is
`packages/native/zig-out/lib/bindings.node`. Use
`pnpm --filter @lodestar/native prepare-minimal` or `prepare-gnosis` to select another
preset. Rebuild before switching presets; they share an output directory.

Bindings use their own Vitest configuration and the root workspace lockfile.
Consensus spec vectors are pinned in [`build.zig.zon`](../../build.zig.zon).
See [contributing](../../CONTRIBUTING.md).

## Publishing

`pnpm release:publish` uses zapi to build and publish the platform packages and
wrapper at the shared version, then runs Lerna for the remaining Lodestar packages.
Use `--dist-tag next` or `--dist-tag rc` for pre-releases. `--dry-run` builds and
prepares the native packages without publishing.

## License

Apache-2.0
