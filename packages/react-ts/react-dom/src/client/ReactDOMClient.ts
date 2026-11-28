/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { createRoot, hydrateRoot } from './ReactDOMRoot';
import { injectIntoDevTools, findHostInstance, } from 'react-reconciler/src/ReactFiberReconciler';
import { canUseDOM } from 'shared/ExecutionEnvironment';
import ReactVersion from 'shared/ReactVersion';
import Internals from 'shared/ReactDOMSharedInternals';
import { ensureCorrectIsomorphicReactVersion } from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();
;
// A class component instance.
function findDOMNode(componentOrElement: object): null | Element | Text {
    return findHostInstance(componentOrElement);
}
// Expose findDOMNode on internals
Internals.findDOMNode = findDOMNode;
export { ReactVersion as version, createRoot, hydrateRoot };
const foundDevTools = injectIntoDevTools();
;
