// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import type {Config} from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import {themes as prismThemes} from "prism-react-renderer";

const config: Config = {
  title: "Lodestar",
  tagline: "TypeScript Implementation of Ethereum Consensus",
  favicon: "img/favicon.ico",

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
        gtag: {
          trackingID: 'G-N21J5PWW5X',
          anonymizeIP: true,
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
        src: "img/logo.png",
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
          title: "Docs",
          items: [
            {
              label: "Introduction",
              to: "/introduction",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "Discord",
              href: "https://discord.com/invite/yjyvFRP",
            },
            {
              label: "Twitter",
              href: "https://twitter.com/lodestar_eth",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ChainSafe, Inc.`,
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
};

export default config;
