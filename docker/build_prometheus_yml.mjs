#!/usr/bin/node

/* eslint-disable @typescript-eslint/no-unused-vars, no-restricted-imports */

import os from "node:os";
import fs from "node:fs";

const BEACON_METRICS_PORT = 8008;
const VALIDATOR_METRICS_PORT = 5064;
const outFile = process.argv[2];
const platform = os.platform();

const hostname =
  platform === "linux"
    ? "localhost"
    : // Mac OS X, Windows can't do network_mode: host properly
      "host.docker.internal";

const nodeCount = parseInt(process.env.NODE_COUNT ?? "") || 1;

/** @type {string[]} */
const targets = [];

for (let i = 0; i < nodeCount; i++) {
  targets.push(`${hostname}:${BEACON_METRICS_PORT + i}`);
  targets.push(`${hostname}:${VALIDATOR_METRICS_PORT + i}`);
}

const prometheusYml = `scrape_configs:
- job_name: Lodestar
  scrape_interval: 20s
  scrape_timeout: 20s
  metrics_path: /metrics
  static_configs:
    # This tag is to be replaced in the Dockerfile with sed
    # Modified datasource to work with a network_mode: host
    - targets: ${JSON.stringify(targets)}`;

fs.writeFileSync(outFile, prometheusYml);
