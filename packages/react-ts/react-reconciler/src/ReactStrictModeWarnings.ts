/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { Fiber } from './ReactInternalTypes';
const ReactStrictModeWarnings = {
    recordUnsafeLifecycleWarnings: (fiber: Fiber, instance: any): void => { },
    flushPendingUnsafeLifecycleWarnings: (): void => { },
    recordLegacyContextWarning: (fiber: Fiber, instance: any): void => { },
    flushLegacyContextWarning: (): void => { },
    discardPendingWarnings: (): void => { },
} as const;
;
export default ReactStrictModeWarnings;
