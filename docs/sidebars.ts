import type {SidebarsConfig} from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    "index",
    "introduction",
    {
      type: "category",
      label: "Getting Started",
      items: ["getting-started/quick-start", "getting-started/installation", "getting-started/starting-a-node"],
    },
    "data-retention",
    {
      type: "category",
      label: "Beacon Node",
      items: [
        "beacon-management/beacon-cli",
        "beacon-management/networking",
        "beacon-management/mev-and-builder-integration",
        "beacon-management/syncing",
      ],
    },
    {
      type: "category",
      label: "Validator",
      items: [
        "validator-management/validator-cli",
        "validator-management/vc-configuration",
        "validator-management/external-signer",
      ],
    },
    {
      type: "category",
      label: "Bootnode",
      items: ["bootnode/bootnode-cli"],
    },
    {
      type: "category",
      label: "Light Client and Prover",
      items: ["lightclient-prover/lightclient-cli", "lightclient-prover/lightclient", "lightclient-prover/prover"],
    },
    {
      type: "category",
      label: "Logging and Metrics",
      items: ["logging-and-metrics/prometheus-grafana", "logging-and-metrics/client-monitoring"],
    },
    "supporting-libraries/index",
    {
      type: "category",
      label: "Contributing",
      items: [
        "contribution/depgraph",
        {
          type: "category",
          label: "Testing",
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
    {
      type: "category",
      label: "Tools",
      items: ["tools/flamegraphs", "tools/heap-dumps", "tools/core-dumps"],
    },
    {
      type: "category",
      label: "Advanced Topics",
      items: ["advanced-topics/setting-up-a-testnet"],
    },
    "faqs",
  ],
};

export default sidebars;
