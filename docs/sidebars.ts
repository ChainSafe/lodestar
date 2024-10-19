import type {SidebarsConfig} from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    "index",
    "introduction",
    "security",
    {
      type: "category",
      label: "Run A Node",
      collapsed: false,
      items: [
        "run/getting-started/quick-start",
        {
          type: "category",
          label: "Installation",
          items: [
            "run/getting-started/installation",
            "run/getting-started/quick-start-custom-guide",
          ],
        },
        {
          type: "category",
          label: "Beacon Node",
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
          items: [
            "run/validator-management/vc-configuration",
            "run/validator-management/validator-cli",
            "run/validator-management/external-signer",
            "run/validator-management/proposer-config",
          ],
        },
        {
          type: "category",
          label: "Logging and Metrics",
          items: [
            "run/logging-and-metrics/prometheus-grafana",
            "run/logging-and-metrics/client-monitoring",
          ],
        },
        {
          type: "category",
          label: "Discv5 Bootnode",
          items: [
            "run/bootnode/bootnode-cli",
          ],
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
          label: "Light Client",
          items: [
            {type: "doc", label: "Getting Started", id: "libraries/lightclient-prover/lightclient"},
            "libraries/lightclient-prover/lightclient-cli",
          ],
        },
        {
          type: "category",
          label: "Prover",
          items: [{type: "doc", label: "Getting Started", id: "libraries/lightclient-prover/prover"}],
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
          type: "doc",
          label: "Getting Started",
          id: "contribution/getting-started",
        },
        {
          type: "category",
          label: "Advanced Topics",
          items: ["contribution/advanced-topics/setting-up-a-testnet"],
        },
        "contribution/depgraph",
        {
          type: "category",
          label: "Development Tools",
          items: [
            "contribution/dev-cli",
            "contribution/tools/debugging",
            "contribution/tools/flamegraphs",
            "contribution/tools/heap-dumps",
            "contribution/tools/core-dumps",
          ],
        },
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
    "faqs",
  ],
};

export default sidebars;
