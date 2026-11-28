/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * `ReactInstanceMap` maintains a mapping from a public facing stateful
 * instance (key) and the internal representation (value). This allows public
 * methods to accept the user facing instance as an argument and map them back
 * to internal methods.
 *
 * Note that this module is currently shared and assumed to be stateless.
 * If this becomes an actual Map, that will break.
 */
import type { Component } from 'react/src/ReactBaseClasses';
import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
// A class component instance's fiber (React's `_reactInternals` expando, declared on Component); undefined when
// the object was never mounted (findDOMNode accepts any object).
export function get(key: object): Fiber | undefined {
    return (key as Component)._reactInternals;
}
export function set(key: Component, value: Fiber): void {
    key._reactInternals = value;
}
