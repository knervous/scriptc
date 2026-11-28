/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { REACT_PORTAL_TYPE } from 'shared/ReactSymbols';
import { checkKeyStringCoercion } from 'shared/CheckStringCoercion';
import type { ReactNodeList, ReactPortal } from 'shared/ReactTypes';
export function createPortal(children: ReactNodeList, containerInfo: unknown, 
// TODO: figure out the API for cross-renderer implementation.
implementation: unknown, key: string | null = null): ReactPortal {
    ;
    return {
        // This tag allow us to uniquely identify this as a React Portal
        $$typeof: REACT_PORTAL_TYPE,
        key: key == null ? null : '' + key,
        children,
        containerInfo,
        implementation,
    };
}
