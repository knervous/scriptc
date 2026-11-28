/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ReactNodeList } from 'shared/ReactTypes';
import ReactVersion from 'shared/ReactVersion';
import { isValidContainer } from 'react-dom-bindings/src/client/ReactDOMContainer';
import { createPortal as createPortalImpl } from 'react-reconciler/src/ReactPortal';
import { flushSync } from './ReactDOMFlushSync';
import { prefetchDNS, preconnect, preload, preloadModule, preinit, preinitModule, } from './ReactDOMFloat';
import { requestFormReset, useFormStatus, useFormState, } from 'react-dom-bindings/src/shared/ReactDOMFormActions';
;
function batchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
    // batchedUpdates is now just a passthrough noop
    return fn(a);
}
function createPortal(children: ReactNodeList, container: Element | DocumentFragment, key: string | null = null): React.ReactPortal {
    if (!isValidContainer(container)) {
        throw new Error('Target container is not a DOM element.');
    }
    // TODO: pass ReactDOM portal implementation as third argument
    return createPortalImpl(children, container, null, key);
}
export { ReactVersion as version, createPortal, flushSync, batchedUpdates as unstable_batchedUpdates, prefetchDNS, preconnect, preload, preloadModule, preinit, preinitModule, requestFormReset, useFormStatus, useFormState, };
