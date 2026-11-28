/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { page, type DomElement, type DomText } from 'dom-stream/dom';
import { toDOMString } from 'shared/dynamicProperty';
import { trackHostMutation } from 'react-reconciler/src/ReactFiberMutationTracking';
import noop from 'shared/noop';
import { listenToNonDelegatedEvent,mediaEventTypes } from '../events/DOMPluginEventSystem';
import { registrationNameDependencies } from '../events/EventRegistry';
import getAttributeAlias from '../shared/getAttributeAlias';
import isCustomElement from '../shared/isCustomElement';
import sanitizeURL from '../shared/sanitizeURL';
import { setValueForStyles } from './CSSPropertyOperations';
import { setValueForAttribute,setValueForKnownAttribute,setValueForNamespacedAttribute,setValueForPropertyOnCustomComponent } from './DOMPropertyOperations';
import { initInput,restoreControlledInputState,updateInput,validateInputProps } from './ReactDOMInput';
import { validateOptionProps } from './ReactDOMOption';
import { initSelect,restoreControlledSelectState,updateSelect,validateSelectProps } from './ReactDOMSelect';
import { initTextarea,restoreControlledTextareaState,updateTextarea,validateTextareaProps } from './ReactDOMTextarea';
import type { HostContext } from './ReactFiberConfigDOM';
import setTextContent from './setTextContent';
;
// HTML parsing normalizes CR and CRLF to LF.
// It also can turn \u0000 into \uFFFD inside attributes.
// https://www.w3.org/TR/html5/single-page.html#preprocessing-the-input-stream
// If we have a mismatch, it might be caused by that.
// We will still patch up in this case but not fire the warning.
const NORMALIZE_NEWLINES_REGEX = /\r\n?/g;
const NORMALIZE_NULL_AND_REPLACEMENT_REGEX = /\u0000|\uFFFD/g;
function normalizeMarkupForTextOrAttribute(markup: unknown): string {
    ;
    const markupString = typeof markup === 'string' ? markup : '' + (markup);
    return markupString
        .replace(NORMALIZE_NEWLINES_REGEX, '\n')
        .replace(NORMALIZE_NULL_AND_REPLACEMENT_REGEX, '');
}
function checkForUnmatchedText(serverText: string, clientText: string | number | bigint) {
    const normalizedClientText = normalizeMarkupForTextOrAttribute(clientText);
    const normalizedServerText = normalizeMarkupForTextOrAttribute(serverText);
    if (normalizedServerText === normalizedClientText) {
        return true;
    }
    return false;
}
export function trapClickOnNonInteractiveElement(node: DomElement) {
    // Mobile Safari does not fire properly bubble click events on
    // non-interactive elements, which means delegated click listeners do not
    // fire. The workaround for this bug involves attaching an empty click
    // listener on the target node.
    // https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html
    // Just set it using the onclick property so that we don't have to manage any
    // bookkeeping for it. Not sure if we need to clear it when the listener is
    // removed.
    // TODO: Only do this for the relevant Safaris maybe?
    node.trapClick();
}
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
function setProp(domElement: DomElement, tag: string, key: string, value: unknown, props: any, prevValue: unknown): void {
    switch (key) {
        case 'children': {
            if (typeof value === 'string') {
                ;
                // Avoid setting initial textContent when the text is empty. In IE11 setting
                // textContent on a <textarea> will cause the placeholder to not
                // show within the <textarea> until it has been focused and blurred again.
                // https://github.com/facebook/react/issues/6731#issuecomment-254874553
                const canSetTextContent = tag !== 'body' && (tag !== 'textarea' || value !== '');
                if (canSetTextContent) {
                    setTextContent(domElement, value);
                }
            }
            else if (typeof value === 'number' || typeof value === 'bigint') {
                ;
                const canSetTextContent = tag !== 'body';
                if (canSetTextContent) {
                    setTextContent(domElement, '' + value);
                }
            }
            else {
                return;
            }
            break;
        }
        // These are very common props and therefore are in the beginning of the switch.
        // TODO: aria-label is a very common prop but allows booleans so is not like the others
        // but should ideally go in this list too.
        case 'className':
            setValueForKnownAttribute(domElement, 'class', value);
            break;
        case 'tabIndex':
            // This has to be case sensitive in SVG.
            setValueForKnownAttribute(domElement, 'tabindex', value);
            break;
        case 'dir':
        case 'role':
        case 'viewBox':
        case 'width':
        case 'height': {
            setValueForKnownAttribute(domElement, key, value);
            break;
        }
        case 'style': {
            setValueForStyles(domElement, value, prevValue);
            return;
        }
        // These attributes accept URLs. These must not allow javascript: URLS.
        case 'data':
            if (tag !== 'object') {
                setValueForKnownAttribute(domElement, 'data', value);
                break;
            }
        // fallthrough
        case 'src': {
            ;
            // Fallthrough
        }
        case 'href': {
            if (value === '' &&
                // <a href=""> is fine for "reload" links.
                !(tag === 'a' && key === 'href')) {
                ;
                domElement.removeAttribute(key);
                break;
            }
            if (value == null ||
                typeof value === 'function' ||
                typeof value === 'symbol' ||
                typeof value === 'boolean') {
                domElement.removeAttribute(key);
                break;
            }
            ;
            const sanitizedValue = (sanitizeURL('' + (value)));
            domElement.setAttribute(key, sanitizedValue);
            break;
        }
        case 'action':
        case 'formAction': {
            ;
            if (typeof value === 'function') {
                // Set a javascript URL that doesn't do anything. We don't expect this to be invoked
                // because we'll preventDefault, but it can happen if a form is manually submitted or
                // if someone calls stopPropagation before React gets the event.
                // If CSP is used to block javascript: URLs that's fine too. It just won't show this
                // error message but the URL will be logged.
                domElement.setAttribute(key, 
                // eslint-disable-next-line no-script-url
                "javascript:throw new Error('" +
                    'A React form was unexpectedly submitted. If you called form.submit() manually, ' +
                    "consider using form.requestSubmit() instead. If you\\'re trying to use " +
                    'event.stopPropagation() in a submit event handler, consider also calling ' +
                    'event.preventDefault().' +
                    "')");
                break;
            }
            else if (typeof prevValue === 'function') {
                // When we're switching off a Server Action that was originally hydrated.
                // The server control these fields during SSR that are now trailing.
                // The regular diffing doesn't apply since we compare against the previous props.
                // Instead, we need to force them to be set to whatever they should be now.
                // This would be a lot cleaner if we did this whole fork in the per-tag approach.
                if (key === 'formAction') {
                    if (tag !== 'input') {
                        // Setting the name here isn't completely safe for inputs if this is switching
                        // to become a radio button. In that case we let the tag based override take
                        // control.
                        setProp(domElement, tag, 'name', props.name, props, null);
                    }
                    setProp(domElement, tag, 'formEncType', props.formEncType, props, null);
                    setProp(domElement, tag, 'formMethod', props.formMethod, props, null);
                    setProp(domElement, tag, 'formTarget', props.formTarget, props, null);
                }
                else {
                    setProp(domElement, tag, 'encType', props.encType, props, null);
                    setProp(domElement, tag, 'method', props.method, props, null);
                    setProp(domElement, tag, 'target', props.target, props, null);
                }
            }
            if (value == null ||
                typeof value === 'symbol' ||
                typeof value === 'boolean') {
                domElement.removeAttribute(key);
                break;
            }
            ;
            const sanitizedValue = (sanitizeURL('' + (value)));
            domElement.setAttribute(key, sanitizedValue);
            break;
        }
        case 'onClick': {
            // TODO: This cast may not be sound for SVG, MathML or custom elements.
            if (value != null) {
                ;
                trapClickOnNonInteractiveElement(domElement);
            }
            return;
        }
        case 'onScroll': {
            if (value != null) {
                ;
                listenToNonDelegatedEvent('scroll', domElement);
            }
            return;
        }
        case 'onScrollEnd': {
            if (value != null) {
                ;
                listenToNonDelegatedEvent('scrollend', domElement);
                ;
            }
            return;
        }
        case 'dangerouslySetInnerHTML': {
            if (value != null) {
                if (typeof value !== 'object' || !('__html' in value)) {
                    throw new Error('`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
                        'Please visit https://react.dev/link/dangerously-set-inner-html ' +
                        'for more information.');
                }
                const nextHtml: any = value.__html;
                if (nextHtml != null) {
                    if (props.children != null) {
                        throw new Error('Can only set one of `children` or `props.dangerouslySetInnerHTML`.');
                    }
                    domElement.setInnerHTML(toDOMString(nextHtml));
                }
            }
            break;
        }
        // Note: `option.selected` is not updated if `select.multiple` is
        // disabled with `removeAttribute`. We have special logic for handling this.
        case 'multiple': {
            // The setter converts to boolean; `!!` is the same conversion.
            domElement.setPropBool('multiple', !!(value && typeof value !== 'function' && typeof value !== 'symbol'));
            break;
        }
        case 'muted': {
            domElement.setPropBool('muted', !!(value && typeof value !== 'function' && typeof value !== 'symbol'));
            break;
        }
        case 'suppressContentEditableWarning':
        case 'suppressHydrationWarning':
        case 'defaultValue': // Reserved
        case 'defaultChecked':
        case 'innerHTML':
        case 'ref': {
            // TODO: `ref` is pretty common, should we move it up?
            // Noop
            break;
        }
        case 'autoFocus': {
            // We polyfill it separately on the client during commit.
            // We could have excluded it in the property list instead of
            // adding a special case here, but then it wouldn't be emitted
            // on server rendering (but we *do* want to emit it in SSR).
            break;
        }
        case 'xlinkHref': {
            if (value == null ||
                typeof value === 'function' ||
                typeof value === 'boolean' ||
                typeof value === 'symbol') {
                domElement.removeAttribute('xlink:href');
                break;
            }
            ;
            const sanitizedValue = (sanitizeURL('' + (value)));
            domElement.setAttributeNS(xlinkNamespace, 'xlink:href', sanitizedValue);
            break;
        }
        case 'contentEditable':
        case 'spellCheck':
        case 'draggable':
        case 'value':
        case 'autoReverse':
        case 'externalResourcesRequired':
        case 'focusable':
        case 'preserveAlpha': {
            // Booleanish String
            // These are "enumerated" attributes that accept "true" and "false".
            // In React, we let users pass `true` and `false` even though technically
            // these aren't boolean attributes (they are coerced to strings).
            // The SVG attributes are case-sensitive. Since the HTML attributes are
            // insensitive they also work even though we canonically use lower case.
            if (value != null &&
                typeof value !== 'function' &&
                typeof value !== 'symbol') {
                ;
                domElement.setAttribute(key, '' + (value));
            }
            else {
                domElement.removeAttribute(key);
            }
            break;
        }
        // Boolean
        case 'inert': {
            ;
        }
        // Fallthrough for boolean props that don't have a warning for empty strings.
        case 'allowFullScreen':
        case 'async':
        case 'autoPlay':
        case 'controls':
        case 'default':
        case 'defer':
        case 'disabled':
        case 'disablePictureInPicture':
        case 'disableRemotePlayback':
        case 'formNoValidate':
        case 'hidden':
        case 'loop':
        case 'noModule':
        case 'noValidate':
        case 'open':
        case 'playsInline':
        case 'readOnly':
        case 'required':
        case 'reversed':
        case 'scoped':
        case 'seamless':
        case 'itemScope': {
            if (value && typeof value !== 'function' && typeof value !== 'symbol') {
                domElement.setAttribute(key, '');
            }
            else {
                domElement.removeAttribute(key);
            }
            break;
        }
        // Overloaded Boolean
        case 'capture':
        case 'download': {
            // An attribute that can be used as a flag as well as with a value.
            // When true, it should be present (set either to an empty string or its name).
            // When false, it should be omitted.
            // For any other value, should be present with that value.
            if (value === true) {
                domElement.setAttribute(key, '');
            }
            else if (value !== false &&
                value != null &&
                typeof value !== 'function' &&
                typeof value !== 'symbol') {
                ;
                domElement.setAttribute(key, toDOMString(value)); // setAttribute's DOMString conversion
            }
            else {
                domElement.removeAttribute(key);
            }
            break;
        }
        case 'cols':
        case 'rows':
        case 'size':
        case 'span': {
            // These are HTML attributes that must be positive numbers.
            if (value != null &&
                typeof value !== 'function' &&
                typeof value !== 'symbol' &&
                !isNaN(Number(value)) &&
                // JavaScript's `>=` coerces the value exactly as Number() does.
                Number(value) >= 1) {
                ;
                domElement.setAttribute(key, toDOMString(value)); // setAttribute's DOMString conversion
            }
            else {
                domElement.removeAttribute(key);
            }
            break;
        }
        case 'rowSpan':
        case 'start': {
            // These are HTML attributes that must be numbers.
            if (value != null &&
                typeof value !== 'function' &&
                typeof value !== 'symbol' &&
                !isNaN(Number(value))) {
                ;
                domElement.setAttribute(key, toDOMString(value)); // setAttribute's DOMString conversion
            }
            else {
                domElement.removeAttribute(key);
            }
            break;
        }
        case 'popover':
            listenToNonDelegatedEvent('beforetoggle', domElement);
            listenToNonDelegatedEvent('toggle', domElement);
            setValueForAttribute(domElement, 'popover', value);
            break;
        case 'xlinkActuate':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:actuate', value);
            break;
        case 'xlinkArcrole':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:arcrole', value);
            break;
        case 'xlinkRole':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:role', value);
            break;
        case 'xlinkShow':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:show', value);
            break;
        case 'xlinkTitle':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:title', value);
            break;
        case 'xlinkType':
            setValueForNamespacedAttribute(domElement, xlinkNamespace, 'xlink:type', value);
            break;
        case 'xmlBase':
            setValueForNamespacedAttribute(domElement, xmlNamespace, 'xml:base', value);
            break;
        case 'xmlLang':
            setValueForNamespacedAttribute(domElement, xmlNamespace, 'xml:lang', value);
            break;
        case 'xmlSpace':
            setValueForNamespacedAttribute(domElement, xmlNamespace, 'xml:space', value);
            break;
        // Properties that should not be allowed on custom elements.
        case 'is': {
            ;
            // TODO: We shouldn't actually set this attribute, because we've already
            // passed it to createElement. We don't also need the attribute.
            // However, our tests currently query for it so it's plausible someone
            // else does too so it's break.
            setValueForAttribute(domElement, 'is', value);
            break;
        }
        case 'innerText':
        case 'textContent':
            return;
        case 'popoverTarget': ;
        // Fall through
        default: {
            if (key.length > 2 &&
                (key[0] === 'o' || key[0] === 'O') &&
                (key[1] === 'n' || key[1] === 'N')) {
                ;
                // Updating events doesn't affect the visuals.
                return;
            }
            else {
                const attributeName = getAttributeAlias(key);
                setValueForAttribute(domElement, attributeName, value);
            }
        }
    }
    // To avoid marking things as host mutations we do early returns above.
    trackHostMutation();
}
function setPropOnCustomElement(domElement: DomElement, tag: string, key: string, value: unknown, props: any, prevValue: unknown): void {
    switch (key) {
        case 'style': {
            setValueForStyles(domElement, value, prevValue);
            return;
        }
        case 'dangerouslySetInnerHTML': {
            if (value != null) {
                if (typeof value !== 'object' || !('__html' in value)) {
                    throw new Error('`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
                        'Please visit https://react.dev/link/dangerously-set-inner-html ' +
                        'for more information.');
                }
                const nextHtml: any = value.__html;
                if (nextHtml != null) {
                    if (props.children != null) {
                        throw new Error('Can only set one of `children` or `props.dangerouslySetInnerHTML`.');
                    }
                    domElement.setInnerHTML(toDOMString(nextHtml));
                }
            }
            break;
        }
        case 'children': {
            if (typeof value === 'string') {
                setTextContent(domElement, value);
            }
            else if (typeof value === 'number' || typeof value === 'bigint') {
                setTextContent(domElement, '' + value);
            }
            else {
                return;
            }
            break;
        }
        case 'onScroll': {
            if (value != null) {
                ;
                listenToNonDelegatedEvent('scroll', domElement);
            }
            return;
        }
        case 'onScrollEnd': {
            if (value != null) {
                ;
                listenToNonDelegatedEvent('scrollend', domElement);
                ;
            }
            return;
        }
        case 'onClick': {
            // TODO: This cast may not be sound for SVG, MathML or custom elements.
            if (value != null) {
                ;
                trapClickOnNonInteractiveElement(domElement);
            }
            return;
        }
        case 'suppressContentEditableWarning':
        case 'suppressHydrationWarning':
        case 'innerHTML':
        case 'ref': {
            // Noop
            return;
        }
        case 'innerText': // Properties
        case 'textContent':
            return;
        // Fall through
        default: {
            if (registrationNameDependencies.hasOwnProperty(key)) {
                ;
                return;
            }
            else {
                setValueForPropertyOnCustomComponent(domElement, key, value);
                // We track mutations inside this call.
                return;
            }
        }
    }
    // To avoid marking things as host mutations we do early returns above.
    trackHostMutation();
}
export function setInitialProperties(domElement: DomElement, tag: string, props: Record<any, any>): void {
    ;
    // TODO: Make sure that we check isMounted before firing any of these events.
    switch (tag) {
        case 'div':
        case 'span':
        case 'svg':
        case 'path':
        case 'a':
        case 'g':
        case 'p':
        case 'li': {
            // Fast track the most common tag types
            break;
        }
        // img tags previously were implemented as void elements with non delegated events however Safari (and possibly Firefox)
        // begin fetching the image as soon as the `src` or `srcSet` property is set and if we set these before other properties
        // that can modify the request (such as crossorigin) or the resource fetch (such as sizes) then the browser will load
        // the wrong thing or load more than one thing. This implementation ensures src and srcSet are set on the instance last
        case 'img': {
            listenToNonDelegatedEvent('error', domElement);
            listenToNonDelegatedEvent('load', domElement);
            // Mostly a port of Void Element logic with special casing to ensure srcset and src are set last
            let hasSrc = false;
            let hasSrcSet = false;
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'src':
                        hasSrc = true;
                        break;
                    case 'srcSet':
                        hasSrcSet = true;
                        break;
                    case 'children':
                    case 'dangerouslySetInnerHTML': {
                        // TODO: Can we make this a DEV warning to avoid this deny list?
                        throw new Error(`${tag} is a void element tag and must neither have \`children\` nor ` +
                            'use `dangerouslySetInnerHTML`.');
                    }
                    // defaultChecked and defaultValue are ignored by setProp
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            if (hasSrcSet) {
                setProp(domElement, tag, 'srcSet', props.srcSet, props, null);
            }
            if (hasSrc) {
                setProp(domElement, tag, 'src', props.src, props, null);
            }
            return;
        }
        case 'input': {
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', domElement);
            let name = null;
            let type = null;
            let value = null;
            let defaultValue = null;
            let checked = null;
            let defaultChecked = null;
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'name': {
                        name = propValue;
                        break;
                    }
                    case 'type': {
                        type = propValue;
                        break;
                    }
                    case 'checked': {
                        checked = propValue;
                        break;
                    }
                    case 'defaultChecked': {
                        defaultChecked = propValue;
                        break;
                    }
                    case 'value': {
                        value = propValue;
                        break;
                    }
                    case 'defaultValue': {
                        defaultValue = propValue;
                        break;
                    }
                    case 'children':
                    case 'dangerouslySetInnerHTML': {
                        if (propValue != null) {
                            throw new Error(`${tag} is a void element tag and must neither have \`children\` nor ` +
                                'use `dangerouslySetInnerHTML`.');
                        }
                        break;
                    }
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            // TODO: Make sure we check if this is still unmounted or do any clean
            // up necessary since we never stop tracking anymore.
            validateInputProps(page(domElement) as Element, props);
            initInput(page(domElement) as Element, value, defaultValue, checked, defaultChecked, type, name, false);
            return;
        }
        case 'select': {
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', domElement);
            let value = null;
            let defaultValue = null;
            let multiple = null;
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'value': {
                        value = propValue;
                        // This is handled by initSelect below.
                        break;
                    }
                    case 'defaultValue': {
                        defaultValue = propValue;
                        // This is handled by initSelect below.
                        break;
                    }
                    case 'multiple': {
                        multiple = propValue;
                        // TODO: We don't actually have to fall through here because we set it
                        // in initSelect anyway. We can remove the special case in setProp.
                    }
                    // Fallthrough
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            validateSelectProps(page(domElement) as Element, props);
            initSelect(page(domElement) as Element, value, defaultValue, multiple);
            return;
        }
        case 'textarea': {
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', domElement);
            let value = null;
            let defaultValue = null;
            let children = null;
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'value': {
                        value = propValue;
                        // This is handled by initTextarea below.
                        break;
                    }
                    case 'defaultValue': {
                        defaultValue = propValue;
                        break;
                    }
                    case 'children': {
                        children = propValue;
                        // Handled by initTextarea above.
                        break;
                    }
                    case 'dangerouslySetInnerHTML': {
                        if (propValue != null) {
                            // TODO: Do we really need a special error message for this. It's also pretty blunt.
                            throw new Error('`dangerouslySetInnerHTML` does not make sense on <textarea>.');
                        }
                        break;
                    }
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            // TODO: Make sure we check if this is still unmounted or do any clean
            // up necessary since we never stop tracking anymore.
            validateTextareaProps(page(domElement) as Element, props);
            initTextarea(page(domElement) as Element, value, defaultValue, children);
            return;
        }
        case 'option': {
            validateOptionProps(page(domElement) as Element, props);
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'selected': {
                        // TODO: Remove support for selected on option.
                        (page(domElement) as HTMLOptionElement).selected =
                            !!(propValue &&
                                typeof propValue !== 'function' &&
                                typeof propValue !== 'symbol');
                        break;
                    }
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            return;
        }
        case 'dialog': {
            listenToNonDelegatedEvent('beforetoggle', domElement);
            listenToNonDelegatedEvent('toggle', domElement);
            listenToNonDelegatedEvent('cancel', domElement);
            listenToNonDelegatedEvent('close', domElement);
            break;
        }
        case 'iframe':
        case 'object': {
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the load event.
            listenToNonDelegatedEvent('load', domElement);
            break;
        }
        case 'video':
        case 'audio': {
            // We listen to these events in case to ensure emulated bubble
            // listeners still fire for all the media events.
            for (let i = 0; i < mediaEventTypes.length; i++) {
                listenToNonDelegatedEvent(mediaEventTypes[i], domElement);
            }
            break;
        }
        case 'image': {
            // We listen to these events in case to ensure emulated bubble
            // listeners still fire for error and load events.
            listenToNonDelegatedEvent('error', domElement);
            listenToNonDelegatedEvent('load', domElement);
            break;
        }
        case 'details': {
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the toggle event.
            listenToNonDelegatedEvent('toggle', domElement);
            break;
        }
        case 'embed':
        case 'source':
        case 'link': {
            // These are void elements that also need delegated events.
            listenToNonDelegatedEvent('error', domElement);
            listenToNonDelegatedEvent('load', domElement);
            // We fallthrough to the return of the void elements
        }
        case 'area':
        case 'base':
        case 'br':
        case 'col':
        case 'hr':
        case 'keygen':
        case 'meta':
        case 'param':
        case 'track':
        case 'wbr':
        case 'menuitem': {
            // Void elements
            for (const propKey in props) {
                if (!props.hasOwnProperty(propKey)) {
                    continue;
                }
                const propValue = props[propKey];
                if (propValue == null) {
                    continue;
                }
                switch (propKey) {
                    case 'children':
                    case 'dangerouslySetInnerHTML': {
                        // TODO: Can we make this a DEV warning to avoid this deny list?
                        throw new Error(`${tag} is a void element tag and must neither have \`children\` nor ` +
                            'use `dangerouslySetInnerHTML`.');
                    }
                    // defaultChecked and defaultValue are ignored by setProp
                    default: {
                        setProp(domElement, tag, propKey, propValue, props, null);
                    }
                }
            }
            return;
        }
        default: {
            if (isCustomElement(tag, props)) {
                for (const propKey in props) {
                    if (!props.hasOwnProperty(propKey)) {
                        continue;
                    }
                    const propValue = props[propKey];
                    if (propValue === undefined) {
                        continue;
                    }
                    setPropOnCustomElement(domElement, tag, propKey, propValue, props, undefined);
                }
                return;
            }
        }
    }
    for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
            continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
            continue;
        }
        setProp(domElement, tag, propKey, propValue, props, null);
    }
}
export function updateProperties(domElement: DomElement, tag: string, lastProps: Record<any, any>, nextProps: Record<any, any>): void {
    ;
    switch (tag) {
        case 'div':
        case 'span':
        case 'svg':
        case 'path':
        case 'a':
        case 'g':
        case 'p':
        case 'li': {
            // Fast track the most common tag types
            break;
        }
        case 'input': {
            let name = null;
            let type = null;
            let value = null;
            let defaultValue = null;
            let lastDefaultValue = null;
            let checked = null;
            let defaultChecked = null;
            for (const propKey in lastProps) {
                const lastProp = lastProps[propKey];
                if (lastProps.hasOwnProperty(propKey) && lastProp != null) {
                    switch (propKey) {
                        case 'checked': {
                            break;
                        }
                        case 'value': {
                            // This is handled by updateWrapper below.
                            break;
                        }
                        case 'defaultValue': {
                            lastDefaultValue = lastProp;
                        }
                        // defaultChecked and defaultValue are ignored by setProp
                        // Fallthrough
                        default: {
                            if (!nextProps.hasOwnProperty(propKey))
                                setProp(domElement, tag, propKey, null, nextProps, lastProp);
                        }
                    }
                }
            }
            for (const propKey in nextProps) {
                const nextProp = nextProps[propKey];
                const lastProp = lastProps[propKey];
                if (nextProps.hasOwnProperty(propKey) &&
                    (nextProp != null || lastProp != null)) {
                    switch (propKey) {
                        case 'type': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            type = nextProp;
                            break;
                        }
                        case 'name': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            name = nextProp;
                            break;
                        }
                        case 'checked': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            checked = nextProp;
                            break;
                        }
                        case 'defaultChecked': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            defaultChecked = nextProp;
                            break;
                        }
                        case 'value': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            value = nextProp;
                            break;
                        }
                        case 'defaultValue': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            defaultValue = nextProp;
                            break;
                        }
                        case 'children':
                        case 'dangerouslySetInnerHTML': {
                            if (nextProp != null) {
                                throw new Error(`${tag} is a void element tag and must neither have \`children\` nor ` +
                                    'use `dangerouslySetInnerHTML`.');
                            }
                            break;
                        }
                        default: {
                            if (nextProp !== lastProp)
                                setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
                        }
                    }
                }
            }
            ;
            // Update the wrapper around inputs *after* updating props. This has to
            // happen after updating the rest of props. Otherwise HTML5 input validations
            // raise warnings and prevent the new value from being assigned.
            updateInput(page(domElement) as Element, value, defaultValue, lastDefaultValue, checked, defaultChecked, type, name);
            return;
        }
        case 'select': {
            let value = null;
            let defaultValue = null;
            let multiple = null;
            let wasMultiple = null;
            for (const propKey in lastProps) {
                const lastProp = lastProps[propKey];
                if (lastProps.hasOwnProperty(propKey) && lastProp != null) {
                    switch (propKey) {
                        case 'value': {
                            // This is handled by updateWrapper below.
                            break;
                        }
                        // defaultValue are ignored by setProp
                        case 'multiple': {
                            wasMultiple = lastProp;
                            // TODO: Move special case in here from setProp.
                        }
                        // Fallthrough
                        default: {
                            if (!nextProps.hasOwnProperty(propKey)) {
                                setProp(domElement, tag, propKey, null, nextProps, lastProp);
                            }
                        }
                    }
                }
            }
            for (const propKey in nextProps) {
                const nextProp = nextProps[propKey];
                const lastProp = lastProps[propKey];
                if (nextProps.hasOwnProperty(propKey) &&
                    (nextProp != null || lastProp != null)) {
                    switch (propKey) {
                        case 'value': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            value = nextProp;
                            // This is handled by updateSelect below.
                            break;
                        }
                        case 'defaultValue': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            defaultValue = nextProp;
                            break;
                        }
                        case 'multiple': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            multiple = nextProp;
                            // TODO: Just move the special case in here from setProp.
                        }
                        // Fallthrough
                        default: {
                            if (nextProp !== lastProp)
                                setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
                        }
                    }
                }
            }
            // <select> value update needs to occur after <option> children
            // reconciliation
            updateSelect(page(domElement) as Element, value, defaultValue, multiple, wasMultiple);
            return;
        }
        case 'textarea': {
            let value = null;
            let defaultValue = null;
            for (const propKey in lastProps) {
                const lastProp = lastProps[propKey];
                if (lastProps.hasOwnProperty(propKey) &&
                    lastProp != null &&
                    !nextProps.hasOwnProperty(propKey)) {
                    switch (propKey) {
                        case 'value': {
                            // This is handled by updateTextarea below.
                            break;
                        }
                        case 'children': {
                            // TODO: This doesn't actually do anything if it updates.
                            break;
                        }
                        // defaultValue is ignored by setProp
                        default: {
                            setProp(domElement, tag, propKey, null, nextProps, lastProp);
                        }
                    }
                }
            }
            for (const propKey in nextProps) {
                const nextProp = nextProps[propKey];
                const lastProp = lastProps[propKey];
                if (nextProps.hasOwnProperty(propKey) &&
                    (nextProp != null || lastProp != null)) {
                    switch (propKey) {
                        case 'value': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            value = nextProp;
                            // This is handled by updateTextarea below.
                            break;
                        }
                        case 'defaultValue': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            defaultValue = nextProp;
                            break;
                        }
                        case 'children': {
                            // TODO: This doesn't actually do anything if it updates.
                            break;
                        }
                        case 'dangerouslySetInnerHTML': {
                            if (nextProp != null) {
                                // TODO: Do we really need a special error message for this. It's also pretty blunt.
                                throw new Error('`dangerouslySetInnerHTML` does not make sense on <textarea>.');
                            }
                            break;
                        }
                        default: {
                            if (nextProp !== lastProp)
                                setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
                        }
                    }
                }
            }
            updateTextarea(page(domElement) as Element, value, defaultValue);
            return;
        }
        case 'option': {
            for (const propKey in lastProps) {
                const lastProp = lastProps[propKey];
                if (lastProps.hasOwnProperty(propKey) &&
                    lastProp != null &&
                    !nextProps.hasOwnProperty(propKey)) {
                    switch (propKey) {
                        case 'selected': {
                            // TODO: Remove support for selected on option.
                            (page(domElement) as HTMLOptionElement).selected = false;
                            break;
                        }
                        default: {
                            setProp(domElement, tag, propKey, null, nextProps, lastProp);
                        }
                    }
                }
            }
            for (const propKey in nextProps) {
                const nextProp = nextProps[propKey];
                const lastProp = lastProps[propKey];
                if (nextProps.hasOwnProperty(propKey) &&
                    nextProp !== lastProp &&
                    (nextProp != null || lastProp != null)) {
                    switch (propKey) {
                        case 'selected': {
                            if (nextProp !== lastProp) {
                                trackHostMutation();
                            }
                            // TODO: Remove support for selected on option.
                            (page(domElement) as HTMLOptionElement).selected =
                                !!(nextProp &&
                                    typeof nextProp !== 'function' &&
                                    typeof nextProp !== 'symbol');
                            break;
                        }
                        default: {
                            setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
                        }
                    }
                }
            }
            return;
        }
        case 'img':
        case 'link':
        case 'area':
        case 'base':
        case 'br':
        case 'col':
        case 'embed':
        case 'hr':
        case 'keygen':
        case 'meta':
        case 'param':
        case 'source':
        case 'track':
        case 'wbr':
        case 'menuitem': {
            // Void elements
            for (const propKey in lastProps) {
                const lastProp = lastProps[propKey];
                if (lastProps.hasOwnProperty(propKey) &&
                    lastProp != null &&
                    !nextProps.hasOwnProperty(propKey)) {
                    setProp(domElement, tag, propKey, null, nextProps, lastProp);
                }
            }
            for (const propKey in nextProps) {
                const nextProp = nextProps[propKey];
                const lastProp = lastProps[propKey];
                if (nextProps.hasOwnProperty(propKey) &&
                    nextProp !== lastProp &&
                    (nextProp != null || lastProp != null)) {
                    switch (propKey) {
                        case 'children':
                        case 'dangerouslySetInnerHTML': {
                            if (nextProp != null) {
                                // TODO: Can we make this a DEV warning to avoid this deny list?
                                throw new Error(`${tag} is a void element tag and must neither have \`children\` nor ` +
                                    'use `dangerouslySetInnerHTML`.');
                            }
                            break;
                        }
                        // defaultChecked and defaultValue are ignored by setProp
                        default: {
                            setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
                        }
                    }
                }
            }
            return;
        }
        default: {
            if (isCustomElement(tag, nextProps)) {
                for (const propKey in lastProps) {
                    const lastProp = lastProps[propKey];
                    if (lastProps.hasOwnProperty(propKey) &&
                        lastProp !== undefined &&
                        !nextProps.hasOwnProperty(propKey)) {
                        setPropOnCustomElement(domElement, tag, propKey, undefined, nextProps, lastProp);
                    }
                }
                for (const propKey in nextProps) {
                    const nextProp = nextProps[propKey];
                    const lastProp = lastProps[propKey];
                    if (nextProps.hasOwnProperty(propKey) &&
                        nextProp !== lastProp &&
                        (nextProp !== undefined || lastProp !== undefined)) {
                        setPropOnCustomElement(domElement, tag, propKey, nextProp, nextProps, lastProp);
                    }
                }
                return;
            }
        }
    }
    for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (lastProps.hasOwnProperty(propKey) &&
            lastProp != null &&
            !nextProps.hasOwnProperty(propKey)) {
            setProp(domElement, tag, propKey, null, nextProps, lastProp);
        }
    }
    for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (nextProps.hasOwnProperty(propKey) &&
            nextProp !== lastProp &&
            (nextProp != null || lastProp != null)) {
            setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
        }
    }
}
function getPropNameFromAttributeName(attrName: string): string {
    switch (attrName) {
        case 'class':
            return 'className';
        case 'for':
            return 'htmlFor';
        // TODO: The rest of the aliases.
        default:
            return attrName;
    }
}
export function getPropsFromElement(domElement: Element): Record<any, any> {
    const serverDifferences: {
        [propName: string]: unknown;
    } = {};
    const attributes = domElement.attributes;
    for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        serverDifferences[getPropNameFromAttributeName(attr.name)] =
            attr.name.toLowerCase() === 'style'
                ? getStylesObjectFromElement(domElement)
                : attr.value;
    }
    return serverDifferences;
}
function getStylesObjectFromElement(domElement: Element): {
    [styleName: string]: string;
} {
    const serverValueInObjectForm: {
        [prop: string]: string;
    } = {};
    const style = (domElement as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
        const styleName: string = style[i];
        // TODO: We should use the original prop value here if it is equivalent.
        // TODO: We could use the original client capitalization if the equivalent
        // other capitalization exists in the DOM.
        serverValueInObjectForm[styleName] = style.getPropertyValue(styleName);
    }
    return serverValueInObjectForm;
}
// Hydration reads the page's own node (a sync point); listeners and the click trap go through the bridge.
export function hydrateProperties(bridged: DomElement, tag: string, props: Record<any, any>, hostContext: HostContext): boolean {
    const domElement = page(bridged) as Element;
    ;
    // TODO: Make sure that we check isMounted before firing any of these events.
    switch (tag) {
        case 'dialog':
            listenToNonDelegatedEvent('cancel', bridged);
            listenToNonDelegatedEvent('close', bridged);
            break;
        case 'iframe':
        case 'object':
        case 'embed':
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the load event.
            listenToNonDelegatedEvent('load', bridged);
            break;
        case 'video':
        case 'audio':
            // We listen to these events in case to ensure emulated bubble
            // listeners still fire for all the media events.
            for (let i = 0; i < mediaEventTypes.length; i++) {
                listenToNonDelegatedEvent(mediaEventTypes[i], bridged);
            }
            break;
        case 'source':
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the error event.
            listenToNonDelegatedEvent('error', bridged);
            break;
        case 'img':
        case 'image':
        case 'link':
            // We listen to these events in case to ensure emulated bubble
            // listeners still fire for error and load events.
            listenToNonDelegatedEvent('error', bridged);
            listenToNonDelegatedEvent('load', bridged);
            break;
        case 'details':
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the toggle event.
            listenToNonDelegatedEvent('toggle', bridged);
            break;
        case 'input':
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', bridged);
            // TODO: Make sure we check if this is still unmounted or do any clean
            // up necessary since we never stop tracking anymore.
            validateInputProps(domElement, props);
            {
                initInput(domElement, props.value, props.defaultValue, props.checked, props.defaultChecked, props.type, props.name, true);
            }
            break;
        case 'option':
            validateOptionProps(domElement, props);
            break;
        case 'select':
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', bridged);
            validateSelectProps(domElement, props);
            break;
        case 'textarea':
            ;
            // We listen to this event in case to ensure emulated bubble
            // listeners still fire for the invalid event.
            listenToNonDelegatedEvent('invalid', bridged);
            // TODO: Make sure we check if this is still unmounted or do any clean
            // up necessary since we never stop tracking anymore.
            validateTextareaProps(domElement, props);
            {
                initTextarea(domElement, props.value, props.defaultValue, props.children);
            }
            break;
    }
    const children = props.children;
    // For text content children we compare against textContent. This
    // might match additional HTML that is hidden when we read it using
    // textContent. E.g. "foo" will match "f<span>oo</span>" but that still
    // satisfies our requirement. Our requirement is not to produce perfect
    // HTML and attributes. Ideally we should preserve structure but it's
    // ok not to if the visible content is still enough to indicate what
    // even listeners these nodes might be wired up to.
    // TODO: Warn if there is more than a single textNode as a child.
    // TODO: Should we use domElement.firstChild.nodeValue to compare?
    if (typeof children === 'string' ||
        typeof children === 'number' ||
        typeof children === 'bigint') {
        if (domElement.textContent !== '' + children &&
            props.suppressHydrationWarning !== true && !checkForUnmatchedText(domElement.textContent, children)) {
            return false;
        }
    }
    if (props.popover != null) {
        // We listen to this event in case to ensure emulated bubble
        // listeners still fire for the toggle event.
        listenToNonDelegatedEvent('beforetoggle', bridged);
        listenToNonDelegatedEvent('toggle', bridged);
    }
    if (props.onScroll != null) {
        listenToNonDelegatedEvent('scroll', bridged);
    }
    if (props.onScrollEnd != null) {
        listenToNonDelegatedEvent('scrollend', bridged);
        ;
    }
    if (props.onClick != null) {
        // TODO: This cast may not be sound for SVG, MathML or custom elements.
        trapClickOnNonInteractiveElement(bridged);
    }
    return true;
}
export function diffHydratedProperties(domElement: Element, tag: string, props: Record<any, any>, hostContext: HostContext): null | Record<any, any> {
    const serverDifferences: {
        [propName: string]: unknown;
    } = {};
    ;
    if (Object.keys(serverDifferences).length === 0) {
        return null;
    }
    return serverDifferences;
}
export function hydrateText(textNode: Text, text: string, parentProps: null | Record<any, any>): boolean {
    const isDifferent = textNode.nodeValue !== text;
    if (isDifferent &&
        (parentProps === null || parentProps.suppressHydrationWarning !== true) &&
        !checkForUnmatchedText(textNode.nodeValue!, text)) {
        return false;
    }
    return true;
}
export function diffHydratedText(textNode: Text, text: string): null | string {
    if (textNode.nodeValue === text) {
        return null;
    }
    const normalizedClientText = normalizeMarkupForTextOrAttribute(text);
    const normalizedServerText = normalizeMarkupForTextOrAttribute(textNode.nodeValue);
    if (normalizedServerText === normalizedClientText) {
        return null;
    }
    return textNode.nodeValue;
}
export function restoreControlledState(domElement: DomElement, tag: string, props: Record<any, any>): void {
    switch (tag) {
        case 'input':
            restoreControlledInputState(page(domElement) as Element, props);
            return;
        case 'textarea':
            restoreControlledTextareaState(page(domElement) as Element, props);
            return;
        case 'select':
            restoreControlledSelectState(page(domElement) as Element, props);
            return;
    }
}
