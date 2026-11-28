/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { PriorityLevel } from './SchedulerPriorities';
import { enableProfiling } from './SchedulerFeatureFlags';
// Bytes per element is 4
const INITIAL_EVENT_LOG_SIZE = 131072; // Equivalent to 2 megabytes
let eventLogSize = 0;
let eventLogBuffer: ArrayBuffer | null = null;
let eventLog: Int32Array | null = null;
let eventLogIndex = 0;
export function startLoggingProfilingEvents(): void {
    eventLogSize = INITIAL_EVENT_LOG_SIZE;
    eventLogBuffer = new ArrayBuffer(eventLogSize * 4);
    eventLog = new Int32Array(eventLogBuffer);
    eventLogIndex = 0;
}
export function stopLoggingProfilingEvents(): ArrayBuffer | null {
    const buffer = eventLogBuffer;
    eventLogSize = 0;
    eventLogBuffer = null;
    eventLog = null;
    eventLogIndex = 0;
    return buffer;
}
export function markTaskStart(task: {
    id: number;
    priorityLevel: PriorityLevel;
}, ms: number) {
    ;
}
export function markTaskCompleted(task: {
    id: number;
    priorityLevel: PriorityLevel;
}, ms: number) {
    ;
}
export function markTaskCanceled(task: {
    id: number;
    priorityLevel: PriorityLevel;
}, ms: number) {
    ;
}
export function markTaskErrored(task: {
    id: number;
    priorityLevel: PriorityLevel;
}, ms: number) {
    ;
}
export function markTaskRun(task: {
    id: number;
    priorityLevel: PriorityLevel;
}, ms: number) {
    ;
}
export function markTaskYield(task: {
    id: number;
}, ms: number) {
    ;
}
export function markSchedulerSuspended(ms: number) {
    ;
}
export function markSchedulerUnsuspended(ms: number) {
    ;
}
