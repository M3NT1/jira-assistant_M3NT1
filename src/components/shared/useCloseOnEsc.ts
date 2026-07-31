import { useEffect, useRef } from 'react';

/**
 * Closes a modal / dialog when the Escape key is pressed (GitHub issue #358).
 * Open dialogs are tracked on a stack so that with nested dialogs only the
 * top most one closes per key press.
 */

const closeHandlerStack: Array<() => void> = [];
let listenerAttached = false;

function handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || !closeHandlerStack.length) {
        return;
    }

    // Let open autocomplete / dropdown popups consume Escape first
    const target = e.target as HTMLElement | null;
    if (target && target.closest('[aria-expanded="true"]')) {
        return;
    }

    e.preventDefault();
    closeHandlerStack[closeHandlerStack.length - 1]();
}

export default function useCloseOnEsc(isOpen: boolean, onClose?: () => void): void {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        // Stable per dialog instance, so re-renders do not change the stack order
        const entry = () => onCloseRef.current?.();
        closeHandlerStack.push(entry);

        if (!listenerAttached) {
            document.addEventListener('keydown', handleKeyDown);
            listenerAttached = true;
        }

        return () => {
            const index = closeHandlerStack.lastIndexOf(entry);
            if (index >= 0) {
                closeHandlerStack.splice(index, 1);
            }
        };
    }, [isOpen]);
}
