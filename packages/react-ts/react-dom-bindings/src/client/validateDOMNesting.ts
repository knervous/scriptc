/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
type Info = {
    tag: string;
};
export type AncestorInfoDev = {
    current: Info | null | undefined;
    formTag: Info | null | undefined;
    aTagInScope: Info | null | undefined;
    buttonTagInScope: Info | null | undefined;
    nobrTagInScope: Info | null | undefined;
    pTagInButtonScope: Info | null | undefined;
    listItemTagAutoclosing: Info | null | undefined;
    dlItemTagAutoclosing: Info | null | undefined;
    // <head> or <body>
    containerTagInScope: Info | null | undefined;
    implicitRootScope: boolean;
};
function updatedAncestorInfoDev(oldInfo: null | AncestorInfoDev, tag: string): null | AncestorInfoDev {
    {
        return null;
    }
}
function validateDOMNesting(childTag: string, ancestorInfo: AncestorInfoDev): boolean {
    ;
    return true;
}
function validateTextNesting(childText: string, parentTag: string, implicitRootScope: boolean): boolean {
    ;
    return true;
}
export { updatedAncestorInfoDev,validateDOMNesting,validateTextNesting };
