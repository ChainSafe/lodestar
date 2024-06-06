import type {SidebarsConfig} from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    "index",
    {
      type: "category",
      label: "Run A Node",
      items: [
        "run/getting-started/quick-start",
        "run/getting-started/installation",
        {
          type: "category",
          label: "Beacon node",
          collapsed: false,
          items: [
            "run/beacon-management/starting-a-node",
            "run/beacon-management/beacon-cli",
            "run/beacon-management/data-retention",
            "run/beacon-management/networking",
            "run/beacon-management/mev-and-builder-integration",
            "run/beacon-management/syncing",
          ],
        },
        {
          type: "category",
          label: "Validator Client",
          collapsed: false,
          items: [
            "run/validator-management/vc-configuration",
            "run/validator-management/validator-cli",
            "run/validator-management/external-signer",
          ],
        },
        {
          type: "category",
          label: "Logging and Metrics",
          collapsed: false,
          items: ["run/logging-and-metrics/prometheus-grafana", "run/logging-and-metrics/client-monitoring"],
        },
        {
          type: "category",
          label: "Discv5 Bootnode",
          collapsed: false,
          items: ["run/bootnode/bootnode-cli"],
        },
      ],
    },
    {
      type: "category",
      label: "Developer Tools",
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Lodestar Light Client",
          items: ["libraries/lightclient-prover/lightclient-cli", "libraries/lightclient-prover/lightclient"],
        },
        {
          type: "category",
          label: "Lodestar Light Prover",
          items: ["libraries/lightclient-prover/prover"],
        },
      ],
    },

    "supporting-libraries/index",
    {
      type: "category",
      label: "Contributing",
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Advanced Topics",
          collapsed: false,
          items: ["contribution/advanced-topics/setting-up-a-testnet"],
        },
        "contribution/depgraph",
        {
          type: "category",
          label: "Development Tools",
          items: [
            "contribution/tools/debugging",
            "contribution/tools/flamegraphs",
            "contribution/tools/heap-dumps",
            "contribution/tools/core-dumps",
          ],
        },
        {
          type: "category",
          label: "Testing",
          collapsed: false,
          items: [
            "contribution/testing/index",
            "contribution/testing/end-to-end-tests",
            "contribution/testing/integration-tests",
            "contribution/testing/performance-tests",
            "contribution/testing/simulation-tests",
            "contribution/testing/spec-tests",
          ],
        },
      ],
    },
    "faqs",
  ],
};

export default sidebars;
