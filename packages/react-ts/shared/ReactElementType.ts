/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export type ReactElement = {
    $$typeof: unknown;
    type: unknown;
    key: string | null;
    ref: unknown;
    props: Record<string, unknown>;
    // Development builds also carry _owner, _store, _debugStack, _debugTask and _debugInfo; production elements carry none
    // of them. The one literal that builds an element (ReactJSXElement) has exactly these fields and types, so an element is
    // one record type, read field by field, rather than a family of shapes read by dynamic dispatch.
};
