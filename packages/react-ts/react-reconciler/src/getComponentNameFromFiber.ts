/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty } from 'shared/dynamicProperty';
import { ActivityComponent,CacheComponent,ClassComponent,ContextConsumer,ContextProvider,DehydratedFragment,ForwardRef,Fragment,FunctionComponent,HostComponent,HostHoistable,HostPortal,HostRoot,HostSingleton,HostText,IncompleteClassComponent,IncompleteFunctionComponent,LazyComponent,LegacyHiddenComponent,MemoComponent,Mode,OffscreenComponent,Profiler,ScopeComponent,SimpleMemoComponent,SuspenseComponent,SuspenseListComponent,Throw,TracingMarkerComponent,ViewTransitionComponent } from 'react-reconciler/src/ReactWorkTags';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import { REACT_STRICT_MODE_TYPE } from 'shared/ReactSymbols';
import type { ReactConsumerType,ReactContext } from 'shared/ReactTypes';
import type { Fiber } from './ReactInternalTypes';
// Keep in sync with shared/getComponentNameFromType
function getWrappedName(outerType: unknown, innerType: any, wrapperName: string): string {
    const functionName = innerType.displayName || innerType.name || '';
    return ((readProperty(outerType as object, 'displayName') as string) || (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName));
}
// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {
    return type.displayName || 'Context';
}
export default function getComponentNameFromFiber(fiber: Fiber): string | null {
    const { tag, type } = fiber;
    switch (tag) {
        case ActivityComponent:
            return 'Activity';
        case CacheComponent:
            return 'Cache';
        case ContextConsumer:
            const consumer: ReactConsumerType<any> = (type);
            return getContextName(consumer._context) + '.Consumer';
        case ContextProvider:
            const context: ReactContext<any> = (type);
            return getContextName(context);
        case DehydratedFragment:
            return 'DehydratedFragment';
        case ForwardRef:
            return getWrappedName(type, type.render, 'ForwardRef');
        case Fragment:
            return 'Fragment';
        case HostHoistable:
        case HostSingleton:
        case HostComponent:
            // Host component type is the display name (e.g. "div", "View")
            return type;
        case HostPortal:
            return 'Portal';
        case HostRoot:
            return 'Root';
        case HostText:
            return 'Text';
        case LazyComponent:
            // Name comes from the type in this case; we don't have a tag.
            return getComponentNameFromType(type);
        case Mode:
            if (type === REACT_STRICT_MODE_TYPE) {
                // Don't be less specific than shared/getComponentNameFromType
                return 'StrictMode';
            }
            return 'Mode';
        case OffscreenComponent:
            return 'Offscreen';
        case Profiler:
            return 'Profiler';
        case ScopeComponent:
            return 'Scope';
        case SuspenseComponent:
            return 'Suspense';
        case SuspenseListComponent:
            return 'SuspenseList';
        case TracingMarkerComponent:
            return 'TracingMarker';
        case ViewTransitionComponent: ;
        // The display name for these tags come from the user-provided type:
        // Fallthrough
        case IncompleteClassComponent:
        case IncompleteFunctionComponent:
            {
                break;
            }
        // Fallthrough
        case ClassComponent:
        case FunctionComponent:
        case MemoComponent:
        case SimpleMemoComponent:
            if (typeof type === 'function') {
                return (type).displayName || type.name || null;
            }
            if (typeof type === 'string') {
                return type;
            }
            break;
        case LegacyHiddenComponent:
            ;
            break;
        case Throw: {
            ;
            return null;
        }
    }
    return null;
}
