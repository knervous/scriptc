/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { readProperty, toDOMString, writeProperty } from 'shared/dynamicProperty';
import DefaultPrepareStackTrace from 'shared/DefaultPrepareStackTrace';
let prefix: string | undefined;
let suffix: string | undefined;
export function describeBuiltInComponentFrame(name: string): string {
    if (prefix === undefined) {
        // Extract the VM specific prefix used by each line.
        try {
            throw Error();
        }
        catch (x: unknown) {
            const stack: string = (x as Error).stack!;
            const match = stack.trim().match(/\n( *(at )?)/);
            prefix = (match && match[1]) || '';
            suffix =
                stack.indexOf('\n    at') > -1
                    ? // V8
                        ' (<anonymous>)'
                    : // JSC/Spidermonkey
                        stack.indexOf('@') > -1
                            ? '@unknown:0:0'
                            : // Other
                                '';
        }
    }
    // We use the prefix to ensure our stacks line up with native stack frames.
    return '\n' + prefix + name + suffix;
}
let reentry = false;
;
/**
 * Leverages native browser/VM stack frames to get proper details (e.g.
 * filename, line + col number) for a single component in a component stack. We
 * do this by:
 *   (1) throwing and catching an error in the function - this will be our
 *       control error.
 *   (2) calling the component which will eventually throw an error that we'll
 *       catch - this will be our sample error.
 *   (3) diffing the control and sample error stacks to find the stack frame
 *       which represents our component.
 */
// A component function, which may carry a user-provided displayName (read with readProperty).
type NamedFunction = Function;
function displayNameOf(fn: Function): unknown {
    return readProperty(fn, 'displayName');
}
// React finds a component's native frame by throwing inside a fake render and parsing the engine's stack text
// (Error.prepareStackTrace, Reflect.construct, Object.defineProperty on a fake prototype). Compiled code has no
// engine frames to parse, so this build takes the fallback React uses when that fails: a frame built from the
// component's name. Component stacks in error info therefore read "at Name" without source locations.
export function describeNativeComponentFrame(fn: NamedFunction, construct: boolean): string {
    // If something asked for a stack inside a fake render, it should get ignored.
    if (!fn || reentry) {
        return '';
    }
    // Fallback to just using the name if we couldn't make it throw.
    // React concatenates whatever displayName holds ('' + value is that concatenation's conversion).
    const name: unknown = fn ? displayNameOf(fn) || fn.name : '';
    const syntheticFrame = name ? describeBuiltInComponentFrame('' + name) : '';
    ;
    return syntheticFrame;
}
export function describeClassComponentFrame(ctor: Function): string {
    return describeNativeComponentFrame(ctor, true);
}
export function describeFunctionComponentFrame(fn: Function): string {
    return describeNativeComponentFrame(fn, false);
}
