import { useRef } from 'react';

import type { BaseGadgetProps } from './types';

interface BaseGadgetUnavailableProps extends BaseGadgetProps {
    title?: string;
    message?: string;
    /** Route the user can open instead, e.g. the Reports page */
    actionHref?: string;
    actionLabel?: string;
}

export function BaseGadgetUnavailable({
    gadgetType,
    dropProps,
    title,
    message,
    actionHref,
    actionLabel,
}: BaseGadgetUnavailableProps) {
    const elementRef = useRef<HTMLDivElement>(null);

    const setRef = (el: HTMLDivElement | null) => {
        elementRef.current = el;
        if (dropProps?.dropRef) {
            dropProps.dropRef(el);
        }
    };

    return (
        <div ref={setRef} className="gadget half-width half-height" data-test-id={gadgetType}>
            <div className="p-panel">
                <div className="p-panel-header">
                    <div className="flex items-center px-3 py-2 font-semibold text-sm truncate">{title || 'Gadget Unavailable'}</div>
                </div>
                <div className="p-panel-content">
                    <div className="p-5 text-center text-secondary text-sm">
                        <i className="fa fa-exclamation-triangle text-2xl text-amber-500 mb-3 block" />
                        {message || 'This section contains an unknown gadget. Please report about this issue to have it fixed!'}
                        {actionHref && (
                            <div className="mt-3">
                                <a href={actionHref} className="link text-blue-600 hover:text-blue-800 underline">
                                    {actionLabel || 'Open'}
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
