/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Flow type for SyntheticEvent class that includes private properties
 */
import type { SyntheticBaseEvent } from './SyntheticEvent';
// The synthetic event class itself (its Interface subclasses share its layout).
export type ReactSyntheticEvent = SyntheticBaseEvent;
export type KnownReactSyntheticEvent = ReactSyntheticEvent;
