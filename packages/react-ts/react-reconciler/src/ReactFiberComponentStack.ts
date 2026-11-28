/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { describeBuiltInComponentFrame,describeClassComponentFrame,describeFunctionComponentFrame } from 'shared/ReactComponentStackFrame';
import type { Fiber } from './ReactInternalTypes';
import { ActivityComponent,ClassComponent,ForwardRef,FunctionComponent,HostComponent,HostHoistable,HostSingleton,LazyComponent,SimpleMemoComponent,SuspenseComponent,SuspenseListComponent,ViewTransitionComponent } from './ReactWorkTags';
function describeFiber(fiber: Fiber, childFiber: null | Fiber): string {
    switch (fiber.tag) {
        case HostHoistable:
        case HostSingleton:
        case HostComponent:
            return describeBuiltInComponentFrame(fiber.type);
        case LazyComponent:
            // TODO: When we support Thenables as component types we should rename this.
            return describeBuiltInComponentFrame('Lazy');
        case SuspenseComponent:
            if (fiber.child !== childFiber && childFiber !== null) {
                // If we came from the second Fiber then we're in the Suspense Fallback.
                return describeBuiltInComponentFrame('Suspense Fallback');
            }
            return describeBuiltInComponentFrame('Suspense');
        case SuspenseListComponent:
            return describeBuiltInComponentFrame('SuspenseList');
        case FunctionComponent:
        case SimpleMemoComponent:
            return describeFunctionComponentFrame(fiber.type);
        case ForwardRef:
            return describeFunctionComponentFrame(fiber.type.render);
        case ClassComponent:
            return describeClassComponentFrame(fiber.type);
        case ActivityComponent:
            return describeBuiltInComponentFrame('Activity');
        case ViewTransitionComponent: ;
        // Fallthrough
        default:
            return '';
    }
}
export function getStackByFiberInDevAndProd(workInProgress: Fiber): string {
    try {
        let info = '';
        let node: Fiber | null = workInProgress;
        let previous: null | Fiber = null;
        do {
            info += describeFiber(node, previous);
            ;
            previous = node;
            node = node.return;
        } while (node);
        return info;
    }
    catch (x: any) {
        return '\nError generating stack: ' + x.message + '\n' + x.stack;
    }
}
