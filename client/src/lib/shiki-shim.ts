/**
 * Custom shiki shim that bundles only commonly-used languages.
 * Reduces chunk count from 232 (full) to ~25, eliminating large
 * rarely-used grammars like emacs-lisp (764KB), cpp (612KB), wasm (608KB), wolfram (260KB).
 *
 * Aliased from 'shiki' via vite.config.ts resolve.alias.
 * Subpath imports (e.g. 'shiki/engine/javascript') are unaffected.
 */
import {
  createSingletonShorthands,
  guessEmbeddedLanguages,
  createBundledHighlighter,
} from "@shikijs/core";
export * from "@shikijs/core";

import { bundledThemes } from "shiki/themes";
export { bundledThemes, bundledThemesInfo } from "shiki/themes";
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from "shiki/engine/javascript";
export { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor };
// Re-export types only — oniguruma engine is not used (streamdown uses JS engine)
// Avoid importing shiki/wasm which adds 622KB to the bundle
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

const bundledLanguagesInfo = [
  { id: "javascript", name: "JavaScript", aliases: ["js", "cjs", "mjs"], import: () => import("@shikijs/langs/javascript") },
  { id: "typescript", name: "TypeScript", aliases: ["ts", "cts", "mts"], import: () => import("@shikijs/langs/typescript") },
  { id: "jsx", name: "JSX", import: () => import("@shikijs/langs/jsx") },
  { id: "tsx", name: "TSX", import: () => import("@shikijs/langs/tsx") },
  { id: "html", name: "HTML", import: () => import("@shikijs/langs/html") },
  { id: "html-derivative", name: "HTML (Derivative)", import: () => import("@shikijs/langs/html-derivative") },
  { id: "css", name: "CSS", import: () => import("@shikijs/langs/css") },
  { id: "json", name: "JSON", import: () => import("@shikijs/langs/json") },
  { id: "jsonc", name: "JSON with Comments", import: () => import("@shikijs/langs/jsonc") },
  { id: "yaml", name: "YAML", aliases: ["yml"], import: () => import("@shikijs/langs/yaml") },
  { id: "toml", name: "TOML", import: () => import("@shikijs/langs/toml") },
  { id: "xml", name: "XML", import: () => import("@shikijs/langs/xml") },
  { id: "markdown", name: "Markdown", aliases: ["md"], import: () => import("@shikijs/langs/markdown") },
  { id: "python", name: "Python", aliases: ["py"], import: () => import("@shikijs/langs/python") },
  { id: "shellscript", name: "Shell", aliases: ["bash", "sh", "shell", "zsh"], import: () => import("@shikijs/langs/shellscript") },
  { id: "sql", name: "SQL", import: () => import("@shikijs/langs/sql") },
  { id: "java", name: "Java", import: () => import("@shikijs/langs/java") },
  { id: "go", name: "Go", import: () => import("@shikijs/langs/go") },
  { id: "rust", name: "Rust", aliases: ["rs"], import: () => import("@shikijs/langs/rust") },
  { id: "php", name: "PHP", import: () => import("@shikijs/langs/php") },
  { id: "c", name: "C", import: () => import("@shikijs/langs/c") },
  { id: "diff", name: "Diff", import: () => import("@shikijs/langs/diff") },
  { id: "graphql", name: "GraphQL", aliases: ["gql"], import: () => import("@shikijs/langs/graphql") },
  { id: "docker", name: "Docker", aliases: ["dockerfile"], import: () => import("@shikijs/langs/docker") },
];

const bundledLanguagesBase = Object.fromEntries(
  bundledLanguagesInfo.map((i) => [i.id, i.import])
);
const bundledLanguagesAlias = Object.fromEntries(
  bundledLanguagesInfo.flatMap((i) =>
    (i as any).aliases?.map((a: string) => [a, i.import]) || []
  )
);
const bundledLanguages = {
  ...bundledLanguagesBase,
  ...bundledLanguagesAlias,
};

const createHighlighter = /* @__PURE__ */ createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => Promise.resolve(createJavaScriptRegexEngine({ forgiving: true })),
});

const {
  codeToHtml,
  codeToHast,
  codeToTokensBase,
  codeToTokens,
  codeToTokensWithThemes,
  getSingletonHighlighter,
  getLastGrammarState,
} = /* @__PURE__ */ createSingletonShorthands(createHighlighter, {
  guessEmbeddedLanguages,
});

export {
  bundledLanguages,
  bundledLanguagesAlias,
  bundledLanguagesBase,
  bundledLanguagesInfo,
  codeToHast,
  codeToHtml,
  codeToTokens,
  codeToTokensBase,
  codeToTokensWithThemes,
  createHighlighter,
  getLastGrammarState,
  getSingletonHighlighter,
};
