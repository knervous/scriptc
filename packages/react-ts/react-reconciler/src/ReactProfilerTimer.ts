
import type { CapturedValue } from './ReactCapturedValue';
import { resolveEventTimeStamp,resolveEventType } from './ReactFiberConfig';
import type { Lane } from './ReactFiberLane';
import { isBlockingLane,isGestureRender,isTransitionLane } from './ReactFiberLane';
import { isAlreadyRendering } from './ReactFiberWorkLoop';
import type { Fiber } from './ReactInternalTypes';
export let renderStartTime: number = -0;
export let commitStartTime: number = -0;
export let componentEffectStartTime: number = -1.1;
export let componentEffectEndTime: number = -1.1;
export function startUpdateTimerByLane(lane: Lane, method: string, fiber: Fiber | null): void {
    {
        return;
    }
}
export function startHostActionTimer(fiber: Fiber): void {
    {
        return;
    }
}
export function startAsyncTransitionTimer(): void {
    {
        return;
    }
}
export function pushNestedEffectDurations(): number {
    {
        return 0;
    }
}
export function resetComponentEffectTimers(): void {
    {
        return;
    }
}
export function pushComponentEffectStart(): number {
    {
        return 0;
    }
}
export function popComponentEffectStart(prevEffectStart: number): void {
    {
        return;
    }
}
export function pushComponentEffectDuration(): number {
    {
        return 0;
    }
}
export function popComponentEffectDuration(prevEffectDuration: number): void {
    {
        return;
    }
}
export function pushComponentEffectErrors(): null | Array<CapturedValue<unknown>> {
    {
        return null;
    }
}
export function popComponentEffectErrors(prevErrors: null | Array<CapturedValue<unknown>>): void {
    {
        return;
    }
}
export function pushComponentEffectDidSpawnUpdate(): boolean {
    {
        return false;
    }
}
export function popComponentEffectDidSpawnUpdate(previousValue: boolean): void {
    {
        return;
    }
}
export function startProfilerTimer(fiber: Fiber): void {
    {
        return;
    }
}
export function stopProfilerTimerIfRunningAndRecordDuration(fiber: Fiber): void {
    {
        return;
    }
}
export function recordEffectDuration(fiber: Fiber): void {
    {
        return;
    }
}
export function startEffectTimer(): void {
    {
        return;
    }
}
export function transferActualDuration(fiber: Fiber): void {
    // Transfer time spent rendering these children so we don't lose it
    // after we rerender. This is used as a helper in special cases
    // where we should count the work of multiple passes.
    // The profiler timer is off in this build: fibers carry no actualDuration (ReactInternalTypes).
    void fiber;
}
