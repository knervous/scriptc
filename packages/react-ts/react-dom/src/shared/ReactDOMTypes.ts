/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { CrossOriginString } from 'react-dom-bindings/src/shared/crossOriginStrings';
export type PreconnectOptions = {
    crossOrigin?: string;
};
export type PreloadOptions = {
    as: string;
    crossOrigin?: string;
    integrity?: string;
    type?: string;
    media?: string;
    nonce?: string;
    fetchPriority?: FetchPriorityEnum;
    imageSrcSet?: string;
    imageSizes?: string;
    referrerPolicy?: string;
};
export type PreloadModuleOptions = {
    as?: string;
    crossOrigin?: string;
    integrity?: string;
    nonce?: string;
};
export type PreinitOptions = {
    as: string;
    precedence?: string;
    crossOrigin?: string;
    integrity?: string;
    nonce?: string;
    fetchPriority?: FetchPriorityEnum;
};
export type PreinitModuleOptions = {
    as?: string;
    crossOrigin?: string;
    integrity?: string;
    nonce?: string;
};
export type CrossOriginEnum = '' | 'use-credentials' | CrossOriginString;
export type FetchPriorityEnum = 'high' | 'low' | 'auto';
export type PreloadImplOptions = {
    crossOrigin?: CrossOriginEnum | null | undefined;
    integrity?: string | null | undefined;
    nonce?: string | null | undefined;
    type?: string | null | undefined;
    fetchPriority?: string | null | undefined;
    referrerPolicy?: string | null | undefined;
    imageSrcSet?: string | null | undefined;
    imageSizes?: string | null | undefined;
    media?: string | null | undefined;
};
export type PreloadModuleImplOptions = {
    as?: string | null | undefined;
    crossOrigin?: CrossOriginEnum | null | undefined;
    integrity?: string | null | undefined;
    nonce?: string | null | undefined;
};
export type PreinitStyleOptions = {
    crossOrigin?: CrossOriginEnum | null | undefined;
    integrity?: string | null | undefined;
    fetchPriority?: string | null | undefined;
};
export type PreinitScriptOptions = {
    crossOrigin?: CrossOriginEnum | null | undefined;
    integrity?: string | null | undefined;
    fetchPriority?: string | null | undefined;
    nonce?: string | null | undefined;
};
export type PreinitModuleScriptOptions = {
    crossOrigin?: CrossOriginEnum | null | undefined;
    integrity?: string | null | undefined;
    nonce?: string | null | undefined;
};
export type HostDispatcher = {
    f /* flushSyncWork */: () => boolean | void;
    r /* requestFormReset */: (form: HTMLFormElement) => void;
    D /* prefetchDNS */: (href: string) => void;
    C /* preconnect */: (href: string, crossOrigin?: CrossOriginEnum | null | undefined) => void;
    L /* preload */: (href: string, as: string, options?: PreloadImplOptions | null | undefined) => void;
    m /* preloadModule */: (href: string, options?: PreloadModuleImplOptions | null | undefined) => void;
    S /* preinitStyle */: (href: string, precedence?: string | null | undefined, options?: PreinitStyleOptions | null | undefined) => void;
    X /* preinitScript */: (src: string, options?: PreinitScriptOptions | null | undefined) => void;
    M /* preinitModuleScript */: (src: string, options?: PreinitModuleScriptOptions | null | undefined) => void;
};
