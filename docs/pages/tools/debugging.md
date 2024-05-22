# Debugging

This page describes different approaches for debugging Lodestar.

## VS Code launch config

The simplest way to debug is to use the provided [launch.template.json](https://github.com/ChainSafe/lodestar/blob/unstable/.vscode/launch.template.json) `configurations`. Copy them as `.vscode/launch.json` and they will be made available in the `Run and Debug` section in VS Code. Adapt as needed, e.g. by adding additional arguments to the beacon [configuration](https://github.com/ChainSafe/lodestar/blob/unstable/.vscode/launch.template.json#L22) to match your needs.

VS Code supports debugging Workers out of the box when using those configurations.

## Attach to running process

Remote `lodestar` processes can also be debugged by leveraging [node:inspector](https://nodejs.org/api/inspector.html). Adding `--inspect` to the node CLI (e.g. `NODE_OPTIONS=--inspect ./lodestar beacon`) allows to debug the main thread. To debug a specific `Worker`, follow those steps:

- remove `--inspect` from `node` CLI
- add following code to the `worker`

```js
import inspector from "node:inspector";
inspector.open();
inspector.waitForDebugger();
```

Use VS Code or Chrome devtools to debug those processes.
