import tseslint from "typescript-eslint";

export default tseslint.config([
  {
    files: ["**/*.ts", "**/*.js"],
    ignores: ["node_modules/**", "dist/**"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "@typescript-eslint/no-unused-vars": ["warn"],
    },
  },
]);
