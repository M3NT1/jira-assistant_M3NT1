import { DashboardLayoutMode, type Dashboard, type DashboardGridLayouts, type Widget, type WidgetGridPosition } from '@types';

/**
 * Breakpoints for the gadget grid. These are measured against the dashboard container
 * width (not the viewport), so the grid also adapts when the sidebar is collapsed.
 * Kept in sync with the column counts assumed by getDefaultSize below.
 */
export const gridBreakpoints = [
    { key: 'xl', minWidth: 2200, columns: 12, label: 'Ultrawide' },
    { key: 'lg', minWidth: 1600, columns: 12, label: 'Wide' },
    { key: 'md', minWidth: 1200, columns: 8, label: 'Desktop' },
    { key: 'sm', minWidth: 760, columns: 4, label: 'Laptop' },
    { key: 'xs', minWidth: 0, columns: 2, label: 'Narrow' },
];

export const gridRowHeight = 40;

/** Breakpoint keys, widest first, so a missing layout can inherit from a wider one */
const breakpointKeys = gridBreakpoints.map((b) => b.key);

/**
 * Default grid footprint per gadget type, in grid units of a 12 column grid.
 * Data-dense gadgets get more width; compact summaries get less. Everything else
 * falls back to half the grid.
 */
const defaultSizes: Record<string, { w: number; h: number; minW?: number; minH?: number }> = {
    todaySummary: { w: 3, h: 11, minW: 2, minH: 8 },
    quickWorklog: { w: 3, h: 11, minW: 2, minH: 9 },
    worklogTimer: { w: 3, h: 11, minW: 2, minH: 8 },
    loggingCompliance: { w: 6, h: 12, minW: 4, minH: 9 },
    weeklyTrend: { w: 6, h: 11, minW: 4, minH: 9 },
    timeDistribution: { w: 6, h: 10, minW: 4, minH: 8 },
    untrackedActivity: { w: 6, h: 11, minW: 4, minH: 7 },
    estimateVsActual: { w: 8, h: 12, minW: 5, minH: 8 },
    recentJiraUpdates: { w: 6, h: 11, minW: 4, minH: 7 },
    staleTickets: { w: 6, h: 11, minW: 4, minH: 7 },
    meetingReconcile: { w: 4, h: 10, minW: 3, minH: 7 },
    myOpenTickets: { w: 6, h: 12, minW: 4, minH: 7 },
    myBookmarks: { w: 6, h: 12, minW: 4, minH: 7 },
    dateWiseWorklog: { w: 6, h: 11, minW: 4, minH: 7 },
    ticketWiseWorklog: { w: 6, h: 11, minW: 4, minH: 7 },
    pendingWorklog: { w: 6, h: 10, minW: 4, minH: 6 },
    worklogBarChart: { w: 6, h: 11, minW: 4, minH: 8 },
    teamWorklogReport: { w: 12, h: 14, minW: 6, minH: 9 },
    sWiseTSpent: { w: 8, h: 12, minW: 5, minH: 8 },
    myFilters: { w: 4, h: 10, minW: 3, minH: 6 },
    agendaDay: { w: 6, h: 14, minW: 4, minH: 10 },
    agendaWeek: { w: 12, h: 14, minW: 6, minH: 10 },
    listDay: { w: 4, h: 11, minW: 3, minH: 7 },
    listWeek: { w: 6, h: 11, minW: 4, minH: 7 },
    listMonth: { w: 6, h: 12, minW: 4, minH: 7 },
};

const fallbackSize = { w: 6, h: 11, minW: 3, minH: 6 };

function getGadgetType(widget: Widget): string {
    return (widget.name || '').split(':')[0];
}

function getDefaultSize(widget: Widget) {
    return defaultSizes[getGadgetType(widget)] || fallbackSize;
}

let idCounter = 0;

function newWidgetId(widget: Widget, index: number): string {
    idCounter++;
    return `${getGadgetType(widget) || 'gadget'}-${index}-${idCounter}`;
}

/**
 * Widgets stored before this change have no id, and the previous React key
 * (`name_index`) collided whenever the same gadget was added twice. Assign stable ids,
 * reporting whether anything changed so the caller can persist the board.
 */
export function ensureWidgetIds(widgets: Widget[]): { widgets: Widget[]; changed: boolean } {
    const seen = new Set<string>();
    let changed = false;

    const result = widgets.map((widget, index) => {
        const existing = typeof widget.id === 'string' ? widget.id : undefined;

        if (existing && !seen.has(existing)) {
            seen.add(existing);
            return widget;
        }

        const id = newWidgetId(widget, index);
        seen.add(id);
        changed = true;
        return { ...widget, id };
    });

    return { widgets: result, changed };
}

/**
 * Build a grid layout for widgets that do not have one yet. Legacy boards carry only
 * `settings.fullWidth` / `settings.fullHeight`, which is honoured so the first switch
 * into grid mode roughly reproduces what the user already had.
 */
export function generateLayoutForBreakpoint(widgets: Widget[], columns: number): WidgetGridPosition[] {
    const layout: WidgetGridPosition[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;

    widgets.forEach((widget) => {
        const preset = getDefaultSize(widget);
        const settings = widget.settings || {};

        // Scale the 12 column defaults down to narrower breakpoints
        const scaled = Math.max(1, Math.round((preset.w / 12) * columns));
        let w = settings.fullWidth ? columns : Math.min(columns, scaled);
        const h = settings.fullHeight ? Math.round(preset.h * 1.6) : preset.h;

        if (w > columns) {
            w = columns;
        }

        if (cursorX + w > columns) {
            cursorX = 0;
            cursorY += rowHeight;
            rowHeight = 0;
        }

        layout.push({
            id: widget.id!,
            x: cursorX,
            y: cursorY,
            w,
            h,
            minW: Math.min(w, Math.max(1, Math.round(((preset.minW ?? 1) / 12) * columns))),
            minH: preset.minH,
        });

        cursorX += w;
        rowHeight = Math.max(rowHeight, h);
    });

    return layout;
}

export function generateLayouts(widgets: Widget[]): DashboardGridLayouts {
    return gridBreakpoints.reduce((acc, bp) => {
        acc[bp.key] = generateLayoutForBreakpoint(widgets, bp.columns);
        return acc;
    }, {} as DashboardGridLayouts);
}

/**
 * Reconcile stored layouts with the current widget list: drop entries for removed
 * widgets and append placements for newly added ones. Runs on every load because
 * gadgets can be added or removed while the board is in classic mode.
 */
export function reconcileLayouts(widgets: Widget[], stored?: DashboardGridLayouts): DashboardGridLayouts {
    if (!stored || !Object.keys(stored).length) {
        return generateLayouts(widgets);
    }

    const ids = widgets.map((w) => w.id!).filter(Boolean);
    const result: DashboardGridLayouts = {};

    gridBreakpoints.forEach(({ key, columns }) => {
        // Inherit from the nearest wider breakpoint when this one was never opened
        const source = stored[key] || inheritFromWider(stored, key);
        const existing = (source || []).filter((item) => ids.includes(item.id));
        const missing = widgets.filter((w) => !existing.some((item) => item.id === w.id));

        if (!missing.length) {
            result[key] = existing;
            return;
        }

        const appended = generateLayoutForBreakpoint(missing, columns);
        const maxY = existing.reduce((max, item) => Math.max(max, item.y + item.h), 0);

        result[key] = [...existing, ...appended.map((item) => ({ ...item, y: item.y + maxY }))];
    });

    return result;
}

function inheritFromWider(stored: DashboardGridLayouts, key: string): WidgetGridPosition[] | undefined {
    const index = breakpointKeys.indexOf(key);
    for (let i = index - 1; i >= 0; i--) {
        const candidate = stored[breakpointKeys[i]];
        if (candidate?.length) {
            return candidate;
        }
    }
    return undefined;
}

export function isGridLayout(board?: Dashboard | null): boolean {
    return board?.layout === DashboardLayoutMode.Grid;
}

function overlaps(a: WidgetGridPosition, b: WidgetGridPosition): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Pull every widget as far up as it will go without overlapping, keeping columns intact.
 * Run only on explicit request ("Tidy up"): doing it after every move is what makes a free
 * arrangement impossible, because untouched gadgets get dragged along.
 */
export function compactLayout(items: WidgetGridPosition[]): WidgetGridPosition[] {
    const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: WidgetGridPosition[] = [];

    ordered.forEach((item) => {
        const moved = { ...item };

        while (moved.y > 0) {
            const candidate = { ...moved, y: moved.y - 1 };
            if (placed.some((other) => overlaps(candidate, other))) {
                break;
            }
            moved.y = candidate.y;
        }

        placed.push(moved);
    });

    return placed;
}

export function compactLayouts(layouts: DashboardGridLayouts): DashboardGridLayouts {
    return Object.keys(layouts).reduce((acc, key) => {
        acc[key] = compactLayout(layouts[key] || []);
        return acc;
    }, {} as DashboardGridLayouts);
}
