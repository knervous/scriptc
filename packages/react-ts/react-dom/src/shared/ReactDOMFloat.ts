/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { getCrossOriginString,getCrossOriginStringAs } from 'react-dom-bindings/src/shared/crossOriginStrings';
import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';
import type { PreconnectOptions,PreinitModuleOptions,PreinitOptions,PreloadModuleOptions,PreloadOptions } from './ReactDOMTypes';
export function prefetchDNS(href: string) {
    ;
    if (typeof href === 'string') {
        ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
            .D(/* prefetchDNS */ href);
    }
    // We don't error because preconnect needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
export function preconnect(href: string, options?: PreconnectOptions | null) {
    ;
    if (typeof href === 'string') {
        const crossOrigin = options
            ? getCrossOriginString(options.crossOrigin)
            : null;
        ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
            .C(/* preconnect */ href, crossOrigin);
    }
    // We don't error because preconnect needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
export function preload(href: string, options: PreloadOptions) {
    ;
    if (typeof href === 'string' &&
        // We check existence because we cannot enforce this function is actually called with the stated type
        typeof options === 'object' &&
        options !== null &&
        typeof options.as === 'string') {
        const as = options.as;
        const crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
        ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
            .L(/* preload */ href, as, {
            crossOrigin,
            integrity: typeof options.integrity === 'string' ? options.integrity : undefined,
            nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
            type: typeof options.type === 'string' ? options.type : undefined,
            fetchPriority: typeof options.fetchPriority === 'string'
                ? options.fetchPriority
                : undefined,
            referrerPolicy: typeof options.referrerPolicy === 'string'
                ? options.referrerPolicy
                : undefined,
            imageSrcSet: typeof options.imageSrcSet === 'string'
                ? options.imageSrcSet
                : undefined,
            imageSizes: typeof options.imageSizes === 'string'
                ? options.imageSizes
                : undefined,
            media: typeof options.media === 'string' ? options.media : undefined,
        });
    }
    // We don't error because preload needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
export function preloadModule(href: string, options?: PreloadModuleOptions | null) {
    ;
    if (typeof href === 'string') {
        if (options) {
            const crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
            ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                .m(/* preloadModule */ href, {
                as: typeof options.as === 'string' && options.as !== 'script'
                    ? options.as
                    : undefined,
                crossOrigin,
                integrity: typeof options.integrity === 'string'
                    ? options.integrity
                    : undefined,
            });
        }
        else {
            ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                .m(/* preloadModule */ href);
        }
    }
    // We don't error because preload needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
export function preinit(href: string, options: PreinitOptions) {
    ;
    if (typeof href === 'string' && options && typeof options.as === 'string') {
        const as = options.as;
        const crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
        const integrity = typeof options.integrity === 'string' ? options.integrity : undefined;
        const fetchPriority = typeof options.fetchPriority === 'string'
            ? options.fetchPriority
            : undefined;
        if (as === 'style') {
            ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                .S(
            /* preinitStyle */
            href, typeof options.precedence === 'string'
                ? options.precedence
                : undefined, {
                crossOrigin,
                integrity,
                fetchPriority,
            });
        }
        else if (as === 'script') {
            ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                .X(/* preinitScript */ href, {
                crossOrigin,
                integrity,
                fetchPriority,
                nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
            });
        }
    }
    // We don't error because preinit needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
export function preinitModule(href: string, options?: PreinitModuleOptions | null) {
    ;
    if (typeof href === 'string') {
        if (typeof options === 'object' && options !== null) {
            if (options.as == null || options.as === 'script') {
                const crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
                ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                    .M(/* preinitModuleScript */ href, {
                    crossOrigin,
                    integrity: typeof options.integrity === 'string'
                        ? options.integrity
                        : undefined,
                    nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
                });
            }
        }
        else if (options == null) {
            ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
                .M(/* preinitModuleScript */ href);
        }
    }
    // We don't error because preinit needs to be resilient to being called in a variety of scopes
    // and the runtime may not be capable of responding. The function is optimistic and not critical
    // so we favor silent bailout over warning or erroring.
}
