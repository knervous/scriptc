/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { checkFormFieldValueStringCoercion } from 'shared/CheckStringCoercion';
export type ToStringValue = boolean | number | bigint | Record<any, any> | string | null | undefined;
// Flow does not allow string concatenation of most non-string types. To work
// around this limitation, we use an opaque type that can only be obtained by
// passing the value through getToStringValue first.
export function toString(value: ToStringValue): string {
    // The coercion safety check is performed in getToStringValue().
    // eslint-disable-next-line react-internal/safe-string-coercion
    return '' + (value);
}
export function getToStringValue(value: unknown): ToStringValue {
    switch (typeof value) {
        case 'bigint':
        case 'boolean':
        case 'number':
        case 'string':
        case 'undefined':
            return value;
        case 'object':
            ;
            return value;
        default:
            // function, symbol are assigned as empty strings
            return '';
    }
}
