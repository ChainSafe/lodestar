// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
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
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: "pages",
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/ChainSafe/lodestar/tree/unstable/docs/",
          routeBasePath: "/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  markdown: {
    mermaid: true,
  },
  themes: [
    '@docusaurus/theme-mermaid',
    '@easyops-cn/docusaurus-search-local'
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
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
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
