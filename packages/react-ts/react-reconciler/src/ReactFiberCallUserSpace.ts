/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { CapturedValue } from './ReactCapturedValue';
interface ClassInstance<R> {
    render(): R;
    componentDidMount(): void;
    componentDidUpdate(prevProps: Record<any, any>, prevState: Record<any, any>, snaphot: Record<any, any>): void;
    componentDidCatch(error: unknown, errorInfo: {
        componentStack: string;
    }): void;
    componentWillUnmount(): void;
}
// Development builds only.
export const callComponentDidCatchInDEV: null | ((instance: ClassInstance<unknown>, errorInfo: CapturedValue<unknown>) => void) = null;
