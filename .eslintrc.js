module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true,
    node: true,
    mocha: true,
  },
  globals: {
    BigInt: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 10,
    project: "./tsconfig.json",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "eslint-plugin-import", "@chainsafe/eslint-plugin-node", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "prettier/prettier": "error",
    //doesnt work, it reports false errors
    "constructor-super": "off",
    "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        pathGroups: [
          {
            pattern: "@lodestar/**",
            group: "internal",
          },
        ],
        pathGroupsExcludedImportTypes: ["builtin"],
      },
    ],
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/naming-convention": [
      "error",
      {selector: "default", format: ["camelCase"]},
      {
        selector: ["classProperty", "objectLiteralProperty", "classMethod", "parameter"],
        format: ["camelCase"],
        leadingUnderscore: "allow",
      },
      //variable must be in camel or upper case
      {selector: "variable", format: ["camelCase", "UPPER_CASE"], leadingUnderscore: "allow"},
      //classes and types must be in PascalCase
      {selector: ["typeLike", "enum"], format: ["PascalCase"]},
      {selector: "enumMember", format: null},
      //ignore rule for quoted stuff
      {
        selector: [
          "classProperty",
          "objectLiteralProperty",
          "typeProperty",
          "classMethod",
          "objectLiteralMethod",
          "typeMethod",
          "accessor",
          "enumMember",
        ],
        format: null,
        modifiers: ["requiresQuotes"],
      },
      //ignore rules on destructured params
      {
        selector: "variable",
        modifiers: ["destructured"],
        format: null,
      },
    ],
    "@typescript-eslint/explicit-function-return-type": [
      "error",
      {
        allowExpressions: true,
      },
    ],
    "@typescript-eslint/func-call-spacing": "error",
    // TODO after upgrading es-lint, member-ordering is now leading to lint errors. Set to warning now and fix in another PR
    "@typescript-eslint/member-ordering": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-require-imports": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/semi": "error",
    "@typescript-eslint/type-annotation-spacing": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/explicit-member-accessibility": ["error", {accessibility: "no-public"}],
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/strict-boolean-expressions": [
      "error",
      {
        allowNullableBoolean: true,
        allowNullableString: true,
        allowAny: true,
      },
    ],
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: false,
        optionalDependencies: false,
        peerDependencies: false,
      },
    ],
    "func-call-spacing": "off",
    //if --fix is run it messes imports like /lib/presets/minimal & /lib/presets/mainnet
    "import/no-duplicates": "off",
    "import/no-relative-packages": "error",
    "@chainsafe/node/no-deprecated-api": "error",
    "new-parens": "error",
    "no-loss-of-precision": "error",
    "no-caller": "error",
    "no-bitwise": "off",
    "no-cond-assign": "error",
    "no-consecutive-blank-lines": 0,
    "no-console": "error",
    "no-var": "error",
    "no-return-await": "error",
    "object-curly-spacing": ["error", "never"],
    "object-literal-sort-keys": 0,
    "no-prototype-builtins": 0,
    "prefer-const": "error",
    quotes: ["error", "double"],
    semi: "off",
    "no-restricted-imports": [
      "error",
      {
        patterns: ["../lib/*", "@chainsafe/*/lib/*"],
        paths: [
          ...restrictNodeModuleImports(
            "child_process",
            "crypto",
            "fs",
            "http",
            "net",
            "os",
            "path",
            "stream",
            "util",
            "url"
          ),
        ],
      },
    ],
    "no-restricted-syntax": ["error", ...restrictImportDestructuring("node:fs", "node:os", "node:path")],
    // Force to add names to all functions to ease CPU profiling
    "func-names": ["error", "always"],

    // TEMP Disabled while eslint-plugin-import support ESM (Typescript does support it) https://github.com/import-js/eslint-plugin-import/issues/2170
    "import/no-unresolved": "off",

    "@chainsafe/node/file-extension-in-import": ["error", "always", {esm: true}],
  },
  settings: {
    "import/internal-regex": "^@chainsafe/",
    "import/core-modules": [
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:http",
      "node:net",
      "node:os",
      "node:path",
      "node:stream",
      "node:util",
      "node:url",
    ],
  },
  overrides: [
    {
      files: ["**/*.config.js", "**/*.config.mjs", "**/*.config.cjs", "**/*.config.ts"],
      rules: {
        // Allow importing packages from dev dependencies
        "import/no-extraneous-dependencies": "off",
        // Allow importing and mixing different configurations
        "import/no-relative-packages": "off",
        "@typescript-eslint/naming-convention": "off",
        // Allow require in CJS modules
        "@typescript-eslint/no-var-requires": "off",
        // Allow require in CJS modules
        "@typescript-eslint/no-require-imports": "off",
      },
    },
    {
      files: ["**/test/**/*.ts"],
      rules: {
        "import/no-extraneous-dependencies": "off",
        // Turned off as it floods log with warnings. Underlying issue is not critical so switching off is acceptable
        "import/no-named-as-default-member": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "func-names": "off",
      },
    },
    {
      files: ["**/test/**/*.test.ts"],
      plugins: ["mocha", "chai-expect"],
      extends: ["plugin:mocha/recommended", "plugin:chai-expect/recommended"],
      rules: {
        // Use of arrow functions are very common
        "mocha/no-mocha-arrows": "off",
        // It's common to call function inside describe block
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-setup-in-describe.md
        "mocha/no-setup-in-describe": "off",
        // We use to split before in small isolated tasks
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-sibling-hooks.md
        "mocha/no-sibling-hooks": "off",
        // We need to disable because we disabled "mocha/no-setup-in-describe" rule
        // TODO: Move all setup code to before/beforeEach and then disable async describe
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-async-describe.md
        "mocha/no-async-describe": "off",
        // We observed that having multiple top level "describe" save valuable indentation
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/max-top-level-suites.md
        "mocha/max-top-level-suites": "off",
      },
    },
    {
      files: ["**/types/**/*.ts"],
      rules: {
        "@typescript-eslint/naming-convention": [
          "off",
          {selector: "interface", prefix: ["I"]},
          {selector: "interface", format: ["PascalCase"], prefix: ["I"]},
        ],
      },
    },
  ],
};

function restrictNodeModuleImports(...modules) {
  return modules.map((module) => ({name: module, message: `Please use 'node:${module}' instead.`}));
}

function restrictImportDestructuring(...modules) {
  return modules.map((module) => ({
    selector: `ImportDeclaration[source.value='${module}'] ImportSpecifier`,
    message: `Importing from '${module}' using destructuring is restricted.`,
  }));
}
