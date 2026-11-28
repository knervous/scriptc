/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// This is forked in server builds where the default stack frame may be source mapped.
const DefaultPrepareStackTrace: undefined | ((error: Error, structuredStackTrace: unknown[]) => string) = undefined;
export default DefaultPrepareStackTrace;
