// The ambient world fixtures compile against: the DOM (forced for browser
// builds) plus Node's types, as the client's own vite-env.d.ts gives the
// client. The gate hosts fixtures in Node, so timer handles and `process`
// are Node's. Before this file, fixtures in the main checkout silently took
// these from client/src/vite-env.d.ts and a scratch worktree had neither.
/// <reference types="node" />
