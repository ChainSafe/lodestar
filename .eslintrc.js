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
    "plugin:@typescript-eslint/recommended",
    "plugin:import/errors",
    "plugin:import/typescript",
    "plugin:import/warnings",
  ],
  rules: {
    "@chainsafe/node/file-extension-in-import": ["error", "always", {esm: true}],
    "@chainsafe/node/no-deprecated-api": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/explicit-function-return-type": ["error", {allowExpressions: true}],
    "@typescript-eslint/explicit-member-accessibility": ["error", {accessibility: "no-public"}],
    "@typescript-eslint/func-call-spacing": "error",
    // TODO after upgrading es-lint, member-ordering is now leading to lint errors. Set to warning now and fix in another PR
    "@typescript-eslint/member-ordering": "off",
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
      {selector: "variable", modifiers: ["destructured"], format: null},
    ],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-require-imports": "error",
    // We usually type-cast these standard types because the concerned function accepts any type
    // and we want to TS detect error if original variable type changes
    "@typescript-eslint/no-unnecessary-type-assertion": ["error", {typesToIgnore: ["string", "bigint", "number"]}],
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-unused-vars": ["error", {varsIgnorePattern: "^_", argsIgnorePattern: "^_"}],
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/restrict-template-expressions": [
      "error",
      {allowNumber: true, allowBoolean: true, allowNullish: true, allowNever: true, allowRegExp: true},
    ],
    "@typescript-eslint/return-await": "error",
    "@typescript-eslint/semi": "error",
    "@typescript-eslint/strict-boolean-expressions": [
      "error",
      {allowNullableBoolean: true, allowNullableString: true, allowAny: true},
    ],

    "@typescript-eslint/type-annotation-spacing": "error",
    "constructor-super": "off",
    "func-call-spacing": "off",
    // Force to add names to all functions to ease CPU profiling
    "func-names": ["error", "always"],
    //if --fix is run it messes imports like /lib/presets/minimal & /lib/presets/mainnet
    "import/no-duplicates": "off",
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: false,
        optionalDependencies: false,
        peerDependencies: false,
      },
    ],
    "import/no-relative-packages": "error",
    // TEMP Disabled while eslint-plugin-import support ESM (Typescript does support it) https://github.com/import-js/eslint-plugin-import/issues/2170
    "import/no-unresolved": "off",
    "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        pathGroups: [{pattern: "@lodestar/**", group: "internal"}],
        pathGroupsExcludedImportTypes: ["builtin"],
      },
    ],
    //doesnt work, it reports false errors
    "new-parens": "error",
    "no-bitwise": "off",
    "no-caller": "error",
    "no-cond-assign": "error",
    "no-consecutive-blank-lines": 0,
    "no-console": "error",
    "no-loss-of-precision": "error",
    "no-prototype-builtins": 0,
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
            "url",
            "worker_threads"
          ),
        ],
      },
    ],
    "no-restricted-syntax": ["error", ...restrictImportDestructuring("node:fs", "node:os", "node:path")],
    // superseded by @typescript-eslint/return-await, must be disabled as it can report incorrect errors
    "no-return-await": "off",
    "no-var": "error",
    "object-curly-spacing": ["error", "never"],
    "object-literal-sort-keys": 0,
    "prefer-const": "error",
    "prettier/prettier": "error",
    quotes: ["error", "double"],
    semi: "off",
  },
  settings: {
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
    "import/resolver": {
      typescript: {
        project: "packages/*/tsconfig.json",
      },
    },
  },
  overrides: [
    {
      files: ["**/*.config.js", "**/*.config.mjs", "**/*.config.cjs", "**/*.config.ts"],
      rules: {
        "@typescript-eslint/naming-convention": "off",
        // Allow require in CJS modules
        "@typescript-eslint/no-require-imports": "off",
        // Allow require in CJS modules
        "@typescript-eslint/no-var-requires": "off",
        // Allow importing packages from dev dependencies
        "import/no-extraneous-dependencies": "off",
        // Allow importing and mixing different configurations
        "import/no-relative-packages": "off",
      },
    },
    {
      files: ["**/test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "func-names": "off",
        "import/no-extraneous-dependencies": "off",
        // Turned off as it floods log with warnings. Underlying issue is not critical so switching off is acceptable
        "import/no-named-as-default-member": "off",
      },
    },
    {
      files: ["**/test/**/*.test.ts"],
      plugins: ["mocha", "chai-expect"],
      extends: ["plugin:mocha/recommended", "plugin:chai-expect/recommended"],
      rules: {
        // We observed that having multiple top level "describe" save valuable indentation
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/max-top-level-suites.md
        "mocha/max-top-level-suites": "off",
        // We need to disable because we disabled "mocha/no-setup-in-describe" rule
        // TODO: Move all setup code to before/beforeEach and then disable async describe
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-async-describe.md
        "mocha/no-async-describe": "off",
        // Use of arrow functions are very common
        "mocha/no-mocha-arrows": "off",
        // It's common to call function inside describe block
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-setup-in-describe.md
        "mocha/no-setup-in-describe": "off",
        // We use to split before in small isolated tasks
        // https://github.com/lo1tuma/eslint-plugin-mocha/blob/master/docs/rules/no-sibling-hooks.md
        "mocha/no-sibling-hooks": "off",
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
