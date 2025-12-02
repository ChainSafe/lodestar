// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import type {Config} from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import {themes as prismThemes} from "prism-react-renderer";

const config: Config = {
  title: "Lodestar",
  tagline: "TypeScript Implementation of Ethereum Consensus",
  favicon: "images/favicon.ico",

  // Set the production url of your site here
  url: "https://chainsafe.github.io/",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/lodestar/",

  // GitHub pages deployment config.
  organizationName: "ChainSafe",
  projectName: "lodestar",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  plugins: [
    [
      "@docusaurus/plugin-client-redirects",
      {
        createRedirects(existingPath: string) {
          if (
            existingPath.includes("/advanced-topics") ||
            existingPath.includes("/getting-started") ||
            existingPath.includes("/beacon-management") ||
            existingPath.includes("/validator-management") ||
            existingPath.includes("/logging-and-metrics") ||
            existingPath.includes("/bootnode") ||
            existingPath.includes("/data-retention")
          ) {
            return ["/run".concat(existingPath)];
          } else if (existingPath.includes("/testing") || existingPath.includes("/tools")) {
            return ["/contribution".concat(existingPath)];
          } else if (existingPath.includes("/lightclient-prover")) {
            return ["/libraries".concat(existingPath)];
          } else if (existingPath.includes("data-retention.md")) {
            return ["/run/beacon-management".concat(existingPath)];
          }
          return undefined; // Return a falsy value: no redirect created
        },
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          path: "pages",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/ChainSafe/lodestar/tree/unstable/docs/",
          routeBasePath: "/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  markdown: {
    mermaid: true,
  },
  themes: ["@docusaurus/theme-mermaid", ["@easyops-cn/docusaurus-search-local", {docsRouteBasePath: "/"}]],

  themeConfig: {
    navbar: {
      title: "Lodestar Documentation",
      logo: {
        alt: "Lodestar Logo",
        src: "images/logo.png",
      },
      items: [
        {
          href: "https://github.com/ChainSafe/lodestar",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          label: 'Lodestar Website',
          href: 'https://lodestar.chainsafe.io',
        },
        {
          label: 'Discord',
          href: 'https://discord.com/invite/yjyvFRP',
        },
        {
          label: 'Twitter/X',
          href: 'https://x.com/lodestar_eth',
        },
        {
          label: 'Github',
          href: 'https://github.com/ChainSafe/lodestar',
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ChainSafe. Built with Docusaurus.` ,
    },
    colorMode: {
      respectPrefersColorScheme: false,
    },
    prism: {
      additionalLanguages: ["bash", "diff", "json"],
      theme: prismThemes.vsLight,
      darkTheme: prismThemes.vsDark,
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 5,
    },
  } satisfies Preset.ThemeConfig,
  scripts: [{src: "https://plausible.io/js/script.js", defer: true, "data-domain": "chainsafe.github.io/lodestar"}],
};

export default config;
