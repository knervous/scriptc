/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
let getCurrentTime: () => number | DOMHighResTimeStamp;
const hasPerformanceNow = typeof performance === 'object' && typeof performance.now === 'function';
if (hasPerformanceNow) {
    const localPerformance = performance;
    getCurrentTime = () => localPerformance.now();
}
else {
    const localDate = Date;
    getCurrentTime = () => localDate.now();
}
