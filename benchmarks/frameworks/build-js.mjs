// Bundles each framework's app against its published package (this package's pinned dev dependencies) as one ES module:
// out/<framework>.js, minified, for the JavaScript lane, and out/<framework>.bundle.js, unminified with its names kept,
// the same code as the input of the published-runtime WasmGC build.
//
//   node benchmarks/frameworks/build-js.mjs [solid] [svelte]
//
// Solid's JSX goes through babel-preset-solid (dom-expressions), Svelte's components and .svelte.ts modules through the
// Svelte compiler. esbuild comes from the workspace (tsx's own dependency); nothing else is installed for it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");

/** JSX through babel-preset-solid; TypeScript survives the transform (the parser reads it, the preset leaves it), so
 * esbuild strips it after. */
export function solidJsx(source, filename, options = {}) {
  const babel = require("@babel/core");
  return babel.transformSync(source, {
    filename, babelrc: false, configFile: false, sourceMaps: false,
    presets: [[require.resolve("babel-preset-solid"), options]],
    parserOpts: { plugins: ["typescript", "jsx"] },
  }).code;
}

/** babel-preset-solid's output, made type-correct for a strict TypeScript build against a typed runtime (the WasmGC port):
 * - a delegated handler written as a property, `el.$$click = h`, becomes `addEventListener(el, "click", h, true)`, which
 *   is what dom-expressions' own addEventListener does with delegate set;
 * - a template walk (`var _el$2 = _el$.firstChild`) asserts its node non-null, as the template guarantees;
 * - `createComponent(C, props)` is written as what it is, `untrack(() => C(props))`, so a generic component (For) is
 *   instantiated from its props.
 * The output is otherwise the preset's own. */
export function solidTypedOutput(code, filename) {
  const babel = require("@babel/core");
  const plugin = ({ types: t }) => ({
    visitor: {
      Program: {
        exit(p, state) {
          if (state.usedListener) p.unshiftContainer("body", t.importDeclaration(
            [t.importSpecifier(t.identifier("_$delegatedListener"), t.identifier("addEventListener"))], t.stringLiteral("solid-js/web")));
          if (state.usedUntrack) p.unshiftContainer("body", t.importDeclaration(
            [t.importSpecifier(t.identifier("_$untrackComponent"), t.identifier("untrack"))], t.stringLiteral("solid-js/web")));
        },
      },
      AssignmentExpression(p, state) {
        const left = p.node.left;
        if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property) || !left.property.name.startsWith("$$")) return;
        state.usedListener = true;
        p.replaceWith(t.callExpression(t.identifier("_$delegatedListener"),
          [left.object, t.stringLiteral(left.property.name.slice(2)), p.node.right, t.booleanLiteral(true)]));
      },
      CallExpression(p, state) {
        const callee = p.node.callee;
        if (!t.isIdentifier(callee, { name: "_$createComponent" }) || p.node.arguments.length !== 2) return;
        state.usedUntrack = true;
        const [comp, props] = p.node.arguments;
        p.replaceWith(t.callExpression(t.identifier("_$untrackComponent"), [t.arrowFunctionExpression([], t.callExpression(comp,
          t.isObjectExpression(props) && props.properties.length === 0 ? [] : [props]))]));
      },
      VariableDeclarator(p) {
        const init = p.node.init;
        if (!t.isIdentifier(p.node.id) || !p.node.id.name.startsWith("_el$") || !t.isMemberExpression(init) || init.computed) return;
        if (!t.isIdentifier(init.property) || (init.property.name !== "firstChild" && init.property.name !== "nextSibling")) return;
        p.node.init = t.tsNonNullExpression(init);
      },
    },
  });
  return babel.transformSync(code, { filename, babelrc: false, configFile: false, sourceMaps: false, plugins: [plugin],
    parserOpts: { plugins: ["typescript", "jsx"] }, generatorOpts: { retainLines: false } }).code;
}

/** A component through the Svelte compiler (it strips the script's TypeScript itself). */
export async function svelteComponent(source, filename, options = {}) {
  const { compile } = await import("svelte/compiler");
  const r = compile(source, { filename, generate: "client", runes: true, warningFilter: (w) => !w.code.startsWith("a11y"), ...options });
  for (const w of r.warnings) console.warn(`${filename}: ${w.message}`);
  return r.js.code;
}

/** A .svelte.ts module: its TypeScript stripped, then its runes through the Svelte compiler. */
export async function svelteModule(source, filename, options = {}) {
  const { compileModule } = await import("svelte/compiler");
  const js = (await esbuild.transform(source, { loader: "ts", format: "esm", target: "es2022" })).code;
  return compileModule(js, { filename, generate: "client", ...options }).js.code;
}

/** svelte/PATCHES.md: the stream lane's one edit to Svelte's runtime. A custom renderer that has parseTree and cloneTree
 * parses a template once and clones it in one call, where Svelte otherwise builds every node of every clone. */
export const SVELTE_STREAM_PATCHES = [
  ["internal/client/dom/template.js",
    "\t\t\tclone = /** @type {TemplateNode} */ (create());\n",
    "\t\t\tclone = /** @type {any} */ (current_renderer).cloneTree\n" +
    "\t\t\t\t? /** @type {any} */ (current_renderer).cloneTree((parsed ??= /** @type {any} */ (current_renderer).parseTree(structure, ns)), is_fragment)\n" +
    "\t\t\t\t: /** @type {TemplateNode} */ (create());\n"],
  ["internal/client/dom/template.js",
    "\t/** The DOM template that is cloned for each instance @type {Node | undefined} */\n\tvar node;\n\n\tfunction create() {\n\t\tvar fragment = fragment_from_tree(structure, ns);",
    "\t/** The DOM template that is cloned for each instance @type {Node | undefined} */\n\tvar node;\n\t/** A custom renderer's parsed template @type {unknown} */\n\tvar parsed;\n\n\tfunction create() {\n\t\tvar fragment = fragment_from_tree(structure, ns);"],
];

/** Text edits to a file as it loads: each [file suffix, exact text (once), replacement]. */
function patching(patches) {
  return {
    name: "patches", setup(b) {
      b.onLoad({ filter: /svelte[\\/]src[\\/].*\.js$/ }, (a) => {
        const mine = patches.filter(([f]) => a.path.replaceAll("\\", "/").endsWith("/src/" + f));
        if (!mine.length) return undefined;
        let text = fs.readFileSync(a.path, "utf8");
        for (const [, from, to] of mine) {
          if (text.split(from).length !== 2) throw new Error(`patch for ${a.path} does not apply: ${JSON.stringify(from.slice(0, 60))}`);
          text = text.replace(from, () => to);
        }
        return { contents: text, loader: "js" };
      });
    },
  };
}

/** The Svelte stream lane's bundle: the app's stream entry, its components compiled for the custom renderer (the
 * renderer module stays an import, compiled as TypeScript with the bundle), and Svelte's runtime with its one patch. */
export async function bundleSvelteStream(outfile) {
  const options = { experimental: { customRenderer: "svelte-stream-renderer" } };
  await esbuild.build({
    entryPoints: [path.join(here, "svelte/stream/main.svelte.ts")], bundle: true, format: "esm", minify: false, outfile,
    conditions: ["browser", "production"], define: { "process.env.NODE_ENV": '"production"' }, external: ["svelte-stream-renderer"],
    nodePaths: [path.join(here, "node_modules")], logLevel: "warning",
    plugins: [patching(SVELTE_STREAM_PATCHES), {
      name: "svelte", setup(b) {
        b.onLoad({ filter: /\.svelte$/ }, async (a) => ({ contents: withoutHoles(await svelteComponent(fs.readFileSync(a.path, "utf8"), a.path, options), a.path), loader: "js" }));
        b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => ({ contents: await svelteModule(fs.readFileSync(a.path, "utf8"), a.path), loader: "js" }));
      },
    }],
  });
}

/** A component's template structures (from_tree) mark a comment with an array hole, `[a, , b]`. The WasmGC compiler has no
 * holes yet, so each is written `undefined`: Svelte reads the structure with for...of and tests `item === undefined`, which
 * a hole and undefined answer alike. */
function withoutHoles(code, filename) {
  const babel = require("@babel/core");
  const plugin = ({ types: t }) => ({ visitor: { ArrayExpression(p) {
    p.node.elements = p.node.elements.map((e) => (e === null ? t.identifier("undefined") : e));
  } } });
  return babel.transformSync(code, { filename, babelrc: false, configFile: false, sourceMaps: false, plugins: [plugin] }).code;
}

const frameworks = {
  solid: {
    entry: "solid/app/js-entry.ts",
    plugin: {
      name: "solid", setup(b) {
        b.onLoad({ filter: /\.tsx$/ }, (a) => ({ contents: solidJsx(fs.readFileSync(a.path, "utf8"), a.path), loader: "ts" }));
      },
    },
  },
  lui: {
    entry: "lui/app/js-entry.ts",
    plugin: {
      name: "lui", setup(b) {
        b.onResolve({ filter: /^@scriptw\/lui$/ }, () => ({ path: path.join(here, "../../packages/lui/src/index.ts") }));
        // LUI's DOM module from its sources (the package's default condition points at its built dist/).
        b.onResolve({ filter: /^#dom$/ }, () => ({ path: path.join(here, "../../packages/lui/src/dom.ts") }));
      },
    },
  },
  svelte: {
    entry: "svelte/app/js-entry.ts",
    plugin: {
      name: "svelte", setup(b) {
        b.onLoad({ filter: /\.svelte$/ }, async (a) => ({ contents: await svelteComponent(fs.readFileSync(a.path, "utf8"), a.path), loader: "js" }));
        b.onLoad({ filter: /\.svelte\.ts$/ }, async (a) => ({ contents: await svelteModule(fs.readFileSync(a.path, "utf8"), a.path), loader: "js" }));
      },
    },
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(frameworks);
  for (const name of which) {
    const f = frameworks[name];
    for (const minify of [true, false]) {
      const outfile = path.join(here, "out", minify ? `${name}.js` : `${name}.bundle.js`);
      await esbuild.build({
        entryPoints: [path.join(here, f.entry)], bundle: true, format: "esm", minify, outfile,
        conditions: ["browser", "production"], define: { "process.env.NODE_ENV": '"production"' },
        nodePaths: [path.join(here, "node_modules")], plugins: [f.plugin], logLevel: "warning",
      });
      console.log(`ok ${path.relative(process.cwd(), outfile)} ${fs.statSync(outfile).size}B`);
    }
  }
}
