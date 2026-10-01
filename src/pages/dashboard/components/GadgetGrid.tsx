import { useCallback, useMemo, useRef } from 'react';

import { DashboardLayout, type DashboardLayoutChangePayload, type DashboardWidget } from 'fluxo-ui';

import type { DashboardGridLayouts, Widget } from '@types';

import { gridBreakpoints, gridRowHeight } from '../layout-utils';

interface GadgetGridProps {
    widgets: Widget[];
    layouts: DashboardGridLayouts;
    editMode: boolean;
    onEditModeChange: (editing: boolean) => void;
    onLayoutsChange: (layouts: DashboardGridLayouts) => void;
    /** Renders the gadget body; the grid supplies the surrounding panel and header */
    renderGadget: (widget: Widget, index: number, headerSlot: HTMLElement) => React.ReactNode;
    gadgetTitle: (widget: Widget) => string;
}

/**
 * Mounts a detached element inside the grid's widget header. The element itself is kept
 * stable across renders so the gadget can portal its buttons into it without the portal
 * target changing identity on every update.
 */
function HeaderSlot({ element }: { element: HTMLElement }) {
    const attach = useCallback(
        (host: HTMLDivElement | null) => {
            if (host && element.parentElement !== host) {
                host.appendChild(element);
            }
        },
        [element],
    );

    return <div ref={attach} className="flex items-center gap-0.5" />;
}

export function GadgetGrid({
    widgets,
    layouts,
    editMode,
    onEditModeChange,
    onLayoutsChange,
    renderGadget,
    gadgetTitle,
}: GadgetGridProps) {
    // One persistent host element per widget id, created lazily and reused
    const slots = useRef<Record<string, HTMLElement>>({});

    const getSlot = useCallback((id: string) => {
        if (!slots.current[id]) {
            slots.current[id] = document.createElement('div');
            slots.current[id].className = 'flex items-center gap-0.5';
        }
        return slots.current[id];
    }, []);

    const dashboardWidgets = useMemo<DashboardWidget[]>(
        () =>
            widgets.map((widget, index) => {
                const id = widget.id!;
                const slot = getSlot(id);

                return {
                    id,
                    title: gadgetTitle(widget),
                    chrome: 'card',
                    // Removal stays on the gadget's own menu: the grid's remove action only
                    // hides a widget, which would leave it in the board silently
                    canRemove: false,
                    canCollapse: true,
                    canMaximize: true,
                    headerActions: <HeaderSlot element={slot} />,
                    children: renderGadget(widget, index, slot),
                };
            }),
        [widgets, getSlot, gadgetTitle, renderGadget],
    );

    const handleChange = useCallback(
        (payload: DashboardLayoutChangePayload) => {
            // Collapse / maximize are transient view state; only persist real geometry changes
            if (payload.reason === 'collapse' || payload.reason === 'expand' || payload.reason === 'maximize' || payload.reason === 'restore') {
                return;
            }
            onLayoutsChange(payload.state.layouts as DashboardGridLayouts);
        },
        [onLayoutsChange],
    );

    return (
        <DashboardLayout
            widgets={dashboardWidgets}
            layouts={layouts}
            onLayoutChange={handleChange}
            breakpoints={gridBreakpoints}
            rowHeight={gridRowHeight}
            margin={[8, 8]}
            containerPadding={[2, 2]}
            editMode={editMode}
            onEditModeChange={onEditModeChange}
            showToolbar={false}
            // Free placement: gadgets stay where they are put instead of being pulled
            // upwards after every move. Compaction is available on demand via "Tidy up".
            compactType={null}
            className="ja-gadget-grid"
        />
    );
}
