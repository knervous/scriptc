# Working on the scriptw package

`npm/wasmgc` holds the `scriptw` npm package: its CLI (`bin/`), its exported entry points (`lib/`), the script that assembles the tarball from a built workspace, and the package's tests. This file is not in the tarball.

## Building the package

From a clone, with Node 24 (`.node-version` pins the release CI uses) and pnpm:

```console
$ pnpm install --frozen-lockfile && pnpm build
$ node npm/wasmgc/scripts/assemble.mjs
$ node npm/wasmgc/test/smoke.mjs npm/wasmgc/.stage/scriptw-<version>.tgz
$ node npm/wasmgc/test/browser.mjs npm/wasmgc/.stage/scriptw-<version>.tgz
$ node --test npm/wasmgc/test/native.test.mjs
```

`assemble.mjs` stages the package under `npm/wasmgc/.stage` (or `--out=<dir>`) and packs it (`--no-pack` stops before packing). The stage mirrors the repository layout for the files the compiler finds relative to itself, so `packages/compiler/dist` and `vendor/binaryen-133` sit side by side. It also writes `build-info.json`, the versions and source commit `scriptw --version` prints: the checkout's `HEAD`, with `-dirty` when tracked files differ, or `SCRIPTW_COMMIT` when set.

The publisher's identity, the author and the GitHub repository that publishes the package, lives in `npm/wasmgc/identity.json` (`{ "author": "...", "repository": "<owner>/<repo>" }`). `assemble.mjs` fills `author`, `repository`, `homepage` and `bugs` from it and substitutes `{{repository}}` in the README. Without it those fields are left out and the README link is a placeholder; the release workflow refuses to publish.

The native companions (`@scriptw/llvm-*`, `runtime-*`, `host-*`) are listed in the template's `companions` field. `SCRIPTW_COMPANIONS=1` makes `assemble.mjs` list them as `optionalDependencies`, each pinned to the package's own version, so the two cannot drift. Leave it unset until they are published: a package must not name optional dependencies the registry does not have.

## Tests

- `test/smoke.mjs <tgz>` installs the tarball into an empty directory, runs each sample under `test/samples` with `scriptw run` and as a built `.wasm`, and compares stdout, stderr and the exit status with Node running the same source. A sample with a `<name>.expect.json` ends in an uncaught error: stdout and the status must match, and stderr must contain the error text. It also builds the page programs under `test/pages` with `--browser`, runs `test/hosted` (a `host:` module) through `scriptw/host` under Node, compiles through `import("scriptw")`, and checks `--version`. It takes about 35 seconds.
- `test/browser.mjs <tgz>` builds `test/pages/*.ts` with `--browser` and loads each in headless Chromium through `scriptw/host` and an import map, then compares the document and console with the page's `.expect.json`. It needs Playwright on `NODE_PATH` or in the working directory; Playwright is not a dependency of the package.
- `test/native.test.mjs` covers which companions a native build needs (`bin/native.mjs`).

CI runs the three on Linux (`scriptw_package` in `.github/workflows/ci.yml`), and the smoke test against the Linux tarball on Windows and macOS (`scriptw_install`), which checks that TypeScript 7's per-platform checker resolves there.

## Native builds from source

A native build (`--target native`, `--target native:<platform>`) takes three companions:

- `@scriptw/llvm-<machine>`: the LLVM helper, for the machine that builds;
- `@scriptw/runtime-<target>`: the precompiled runtime for the target;
- `@scriptw/host-<target>`: the native host a page program (`--browser`) links.

Until they are published, a native build takes each from a directory: `SCRIPTW_LLVM_PACK`, `SCRIPTW_RUNTIME_PACK` and `SCRIPTW_HOST_PACK`. `android-arm64` writes `<name>/libmain.so` and needs the Android NDK (`ANDROID_NDK_ROOT`, or `sdkmanager 'ndk;30.0.16248370'`).

`--host auto` (the default) links the host pack's smallest set that holds the services the program reaches: `full`, `ui` (window, GPU and network), `headless` (network only) or `offline`. `--host <set>` names one, `--host-features audio,-rtc` adjusts the choice, `--explain-host` prints it, `--host-lib <archive>` links your own `scr_host_ops()`, and `--host quickjs` keeps the embedded engine instead of a host.

## Releasing

Releases run from `.github/workflows/release-scriptw.yml`, on a `scriptw-v<version>` tag or by hand (Actions, Release scriptw, Run workflow). It runs only in the repository `identity.json` names: it builds, assembles, runs the smoke and browser tests, checks that the packed `repository.url` names the running repository and that `build-info.json` carries the workflow's commit, then runs `npm publish <tgz> --provenance --access public` with npm trusted publishing. The repository holds no npm token. Publishing is the owner's step; the workflow and this setup are what it needs.

To release a version:

1. Set `version` in `npm/wasmgc/package.json`, and add its entry to `npm/wasmgc/CHANGELOG.md`.
2. Commit, then push the tag `scriptw-v<version>`; the workflow refuses a tag that does not match `package.json`.

### One-time setup on npmjs.com

These follow npm's documentation ([trusted publishers](https://docs.npmjs.com/trusted-publishers), [provenance](https://docs.npmjs.com/generating-provenance-statements), [2FA for publishing](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification), [unscoped public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages)), read on 2026-11-27.

1. **Account and 2FA.** An npm user account with two-factor authentication on. `scriptw` is unscoped, and unscoped packages are always public, so no npm organization is needed. The companions' `@scriptw` scope would need an organization (or user) named `scriptw` when they are published.
2. **The first publish.** npm configures a trusted publisher on the package's own settings page, and its documentation does not say whether a name that has never been published can have one. Plan on publishing 0.1.0 once by hand from a checked build: `node npm/wasmgc/scripts/assemble.mjs`, run the smoke and browser tests, then `npm publish npm/wasmgc/.stage/scriptw-0.1.0.tgz --access public` with your 2FA code. A manual publish from a laptop carries no provenance statement, since provenance needs a supported CI provider. If npm offers the trusted-publisher form for the unpublished name, skip this step and let the workflow publish 0.1.0.
3. **The trusted publisher.** On the package's Settings page, under Trusted Publisher, choose GitHub Actions and enter the organization or user and the repository from `identity.json`, the workflow filename `release-scriptw.yml` (the filename only), and no environment. The fields are case-sensitive. npm does not check them when saved; the first publish through the workflow must succeed within two days of creating the configuration, and that publish binds it to the repository.
4. **Lock the package down.** Under Settings, Publishing access, select "Require two-factor authentication and disallow tokens". The workflow still publishes, because trusted publishing uses OIDC rather than a token.

What the workflow relies on: a GitHub-hosted runner, `id-token: write`, npm 11.5.1 or later (it installs 11.6.2), and Node 22.14.0 or later (it uses the pinned 24). With trusted publishing npm generates provenance by default; the explicit `--provenance` changes nothing then, and makes a publish that cannot produce provenance fail instead of going out without it. Provenance needs a public repository, and npm compares `repository.url` in the packed `package.json`, case-sensitively, with the repository the workflow runs in.

## Experimental: tsc-ts as a WasmGC checker

`tsc-ts/` holds the first steps toward a package with no native executable: tsc-ts (the TypeScript 7 checker ported to TypeScript) compiled to WasmGC by this compiler, to stand in for tsgo.

```console
$ git clone --depth 1 --branch v0.1.5 https://github.com/vercel-labs/tsc-ts
$ (cd tsc-ts && npm ci --ignore-scripts --omit=optional)
$ node npm/wasmgc/tsc-ts/prepare.mjs tsc-ts
$ node --max-old-space-size=14000 npm/wasmgc/tsc-ts/compile.mjs tsc-ts out/tsc-ts.wasm
```

`prepare.mjs` cuts tsc-ts's thread machinery, which a WasmGC build never uses. The compile gets through the whole program's frontend and lowering and stops at one internal compiler error: `Symbol.getMembers` and `Symbol.getExports` call a function the lowering drops (`byEscapedName` in `src/compiler/symbol.ts`). It does not yet emit a module, so the package still uses tsgo.
