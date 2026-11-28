/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
/* eslint-disable react-internal/no-production-logging */
import type { Fiber } from './ReactInternalTypes';
const supportsUserTiming = false;
const COMPONENTS_TRACK = 'Components ⚛';
function logComponentTrigger(fiber: Fiber, startTime: number, endTime: number, trigger: string) {
    if (supportsUserTiming) {
        reusableComponentOptions.start = startTime;
        reusableComponentOptions.end = endTime;
        reusableComponentDevToolDetails.color = 'warning';
        reusableComponentDevToolDetails.tooltipText = trigger;
        reusableComponentDevToolDetails.properties = null;
        {
            performance.measure(trigger, reusableComponentOptions);
        }
    }
}
export function logComponentReappeared(fiber: Fiber, startTime: number, endTime: number): void {
    logComponentTrigger(fiber, startTime, endTime, 'Reconnect');
}
export function pushDeepEquality(): boolean {
    ;
    return false;
}
export function popDeepEquality(prev: boolean): void {
    ;
}
const reusableComponentDevToolDetails: {
    color: string;
    properties: null | Array<[
        string,
        string
    ]>;
    tooltipText: string;
    track: string;
} = {
    color: 'primary',
    properties: null,
    tooltipText: '',
    track: COMPONENTS_TRACK,
};
const reusableComponentOptions: PerformanceMeasureOptions = {
    start: -0,
    end: -0,
    detail: {
        devtools: reusableComponentDevToolDetails,
    },
};
