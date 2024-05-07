---
title: Debugging
---

The simplest way to debug is to use the provided [launch.json](../../../.vscode/launch.json) `configurations`, made available in the `Run and Debug` section. Those configurations will start new `node` processes.
VS Code supports debugging Workers out of the box when using those configurations.

Remote `lodestar` processes can also be debugged by leveraging [node:inspector](https://nodejs.org/api/inspector.html). Adding `--inspect` to the node CLI (e.g. `NODE_OPTIONS=--inspect ./lodestar beacon`) allows to debug the main thread. To debug a specific `Worker`, follow those steps:

- remove `--inspect` from `node` CLI
- add following code to the `worker`

```js
import inspector from "node:inspector";
inspector.open();
inspector.waitForDebugger();
```
