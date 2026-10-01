import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useParams } from 'react-router-dom';

import { Sortable } from 'fluxo-ui';

import { GadgetActionType } from '@/constants';

import { inject } from '@services';

import { TabPage, TabView } from '@components';

import { DashboardLayoutMode, type Dashboard as DashboardType, type DashboardGridLayouts, type Widget } from '@types';

import AddWorklog from '@dialogs/AddWorklog';

import { dashboardEventEmitter } from '../../gadgets/BaseGadget';

import { AddGadget } from './components/AddGadget';
import { DashboardHeader } from './components/DashboardHeader';
import { GadgetGrid } from './components/GadgetGrid';
import './Dashboard.css';
import { getGadgetComponent } from './gadget-registry';
import { compactLayouts, ensureWidgetIds, generateLayouts, isGridLayout, reconcileLayouts } from './layout-utils';

interface GadgetAction {
    type: number;
    data?: any;
}

function loadBoardAtIndex(dashboards: DashboardType[], index: number) {
    const actualIndex = index >= dashboards.length ? 0 : index;
    return dashboards[actualIndex] ?? null;
}

/**
 * Boards stored before grid layout existed have no widget ids. Backfill them in place so
 * the session copy and the grid agree, and report whether the board needs saving.
 */
function prepareBoard(board: DashboardType | null): { board: DashboardType | null; changed: boolean } {
    if (!board?.widgets?.length) {
        return { board, changed: false };
    }

    const { widgets, changed } = ensureWidgetIds(board.widgets);
    if (!changed) {
        return { board, changed: false };
    }

    board.widgets = widgets;
    return { board, changed: true };
}

export default function Dashboard() {
    const { index: indexParam } = useParams();
    const dashboardIndex = parseInt(indexParam || '0');

    const { $dashboard, $session } = inject('DashboardService', 'SessionService');

    const dashboardIndexRef = useRef(dashboardIndex);

    const dashboards: DashboardType[] = $session.CurrentUser?.dashboards || [];
    const quickView = $session.isQuickView || false;
    const initialBoard = prepareBoard(loadBoardAtIndex(dashboards, dashboardIndex)).board;

    const [currentBoard, setCurrentBoard] = useState<DashboardType | null>(initialBoard);
    const currentBoardRef = useRef<DashboardType | null>(initialBoard);
    const [isTabView, setIsTabView] = useState(quickView || initialBoard?.isTabView || false);
    const [gridEditMode, setGridEditMode] = useState(false);

    useEffect(() => {
        dashboardIndexRef.current = dashboardIndex;
        const { board, changed } = prepareBoard(loadBoardAtIndex(dashboards, dashboardIndex));
        currentBoardRef.current = board;
        setCurrentBoard(board);
        setIsTabView(quickView || board?.isTabView || false);
        setGridEditMode(false);

        if (changed && board) {
            $dashboard.saveDashboardInfo(dashboardIndex, board);
        }
    }, [dashboardIndex]); // eslint-disable-line react-hooks/exhaustive-deps
    const [showGadgetPanel, setShowGadgetPanel] = useState(false);
    const [showWorklogPopup, setShowWorklogPopup] = useState(false);
    const [worklogItem, setWorklogItem] = useState<any>(null);
    const [tabHeaderSlot, setTabHeaderSlot] = useState<HTMLElement | null>(null);

    const updateCurrentBoard = (board: DashboardType) => {
        currentBoardRef.current = board;
        setCurrentBoard(board);
    };

    const saveDashboardInfo = (board?: DashboardType) => {
        const boardToSave = board ?? currentBoardRef.current;
        if (!boardToSave) return;
        $dashboard.saveDashboardInfo(dashboardIndexRef.current, boardToSave);
    };

    const addGadget = (gadgetName: string, settings?: any) => {
        if (!currentBoardRef.current) return;
        const updatedBoard = { ...currentBoardRef.current };
        const appended = [...(updatedBoard.widgets || []), { name: gadgetName, settings: settings || {} }];
        updatedBoard.widgets = ensureWidgetIds(appended).widgets;
        updateCurrentBoard(updatedBoard);
    };

    const removeGadget = (gadgetName: string) => {
        if (!currentBoardRef.current) return;
        const updatedBoard = { ...currentBoardRef.current };
        updatedBoard.widgets = (updatedBoard.widgets || []).filter((g: any) => g.name !== gadgetName);
        updateCurrentBoard(updatedBoard);
    };

    const emitToChildren = (action: GadgetAction, widgetIndex: number) => {
        dashboardEventEmitter.emit('change', action, widgetIndex);
    };

    const widgetAction = (action: GadgetAction, gadget: Widget, widgetIndex: number) => {
        switch (action.type) {
            case GadgetActionType.AddWorklog:
                setWorklogItem(action.data);
                setShowWorklogPopup(true);
                break;

            case GadgetActionType.RemoveGadget: {
                if (!currentBoardRef.current) return;
                const updatedBoard = { ...currentBoardRef.current };
                const widgets = [...(updatedBoard.widgets || [])];
                widgets.splice(widgetIndex, 1);
                updatedBoard.widgets = widgets;
                updateCurrentBoard(updatedBoard);
                saveDashboardInfo(updatedBoard);
                emitToChildren(action, widgetIndex);
                break;
            }

            case GadgetActionType.SettingsChanged:
                if (gadget) {
                    gadget.settings = action.data;
                    saveDashboardInfo();
                }
                break;

            default:
                emitToChildren(action, widgetIndex);
                break;
        }
    };

    const gadgetReordered = (widgets: Widget[]) => {
        if (!currentBoardRef.current) return;
        const updatedBoard = { ...currentBoardRef.current, widgets };
        updateCurrentBoard(updatedBoard);
        saveDashboardInfo(updatedBoard);
    };

    const isGrid = isGridLayout(currentBoard) && !isTabView && !quickView;

    // Stored placements are reconciled with the live widget list, so gadgets added or
    // removed while in classic mode still get a slot when grid mode is turned back on
    const gridLayouts = useMemo(
        () => (isGrid ? reconcileLayouts(currentBoard?.widgets || [], currentBoard?.layouts) : {}),
        [isGrid, currentBoard?.widgets, currentBoard?.layouts],
    );

    const layoutsChanged = useCallback(
        (layouts: DashboardGridLayouts) => {
            if (!currentBoardRef.current) return;
            const updatedBoard = { ...currentBoardRef.current, layouts };
            updateCurrentBoard(updatedBoard);
            saveDashboardInfo(updatedBoard);
        },
        [], // eslint-disable-line react-hooks/exhaustive-deps
    );

    const gadgetTitle = useCallback((widget: Widget) => {
        const nameOpts = (widget.name || '').split(':');
        const registered = getGadgetComponent(nameOpts[0], nameOpts.slice(1));
        return registered?.props?.title || nameOpts[0];
    }, []);

    const renderGadget = (widget: Widget, index: number, dragDropProps?: any, hostHeaderSlot?: HTMLElement) => {
        const { name, settings = {} } = widget;
        const nameOpts = name.split(':');
        const gadgetName = nameOpts[0];
        const opts = nameOpts.length > 1 ? nameOpts.slice(1) : [];

        const GadgetComponent = getGadgetComponent(gadgetName, opts);

        if (!GadgetComponent) {
            return null;
        }

        const { Component, props: additionalProps } = GadgetComponent;

        const key = widget.id || `${gadgetName}_${opts[0] || index}`;
        const gadgetProps = {
            gadgetType: gadgetName,
            tabLayout: isTabView,
            tabHeaderSlot: isTabView ? tabHeaderSlot : null,
            hostedChrome: !!hostHeaderSlot,
            hostHeaderSlot: hostHeaderSlot || null,
            index,
            model: widget,
            settings,
            isGadget: true,
            layout: currentBoard?.layout,
            onAction: (action: any) => widgetAction(action, widget, index),
            ...additionalProps,
            draggableHandle: dragDropProps?.draggable?.dragRef,
            dropProps: dragDropProps?.droppable,
        };

        if (isTabView) {
            const title = additionalProps?.title || gadgetName;
            return (
                <TabPage key={key} header={title}>
                    <Component {...gadgetProps} />
                </TabPage>
            );
        }

        return <Component key={key} {...gadgetProps} />;
    };

    const renderGridGadget = useCallback(
        (widget: Widget, index: number, headerSlot: HTMLElement) => renderGadget(widget, index, undefined, headerSlot),
        [renderGadget], // eslint-disable-line react-hooks/exhaustive-deps
    );

    const renderGadgets = () => {
        const widgets = currentBoard?.widgets || [];

        if (!widgets.length) {
            return (
                <div className="text-center text-base rounded-lg p-20 w-full min-h-[40vh] flex items-center justify-center border-2 border-dashed border-(--border-secondary) bg-(--bg-secondary) text-secondary">
                    You haven&apos;t added any gadgets to this dashboard. Click on &quot;Add gadgets&quot; button above to start adding a
                    cool one and personalize your experience.
                </div>
            );
        }

        if (isTabView) {
            return (
                <TabView
                    scrollable
                    className="h-[calc(100vh-102px)]"
                    headerEnd={<div ref={setTabHeaderSlot} className="flex items-center gap-0.5 shrink-0" />}
                >
                    {widgets.map((widget, index) => renderGadget(widget, index))}
                </TabView>
            );
        }

        if (isGrid) {
            return (
                <GadgetGrid
                    widgets={widgets}
                    layouts={gridLayouts}
                    editMode={gridEditMode}
                    onEditModeChange={setGridEditMode}
                    onLayoutsChange={layoutsChanged}
                    renderGadget={renderGridGadget}
                    gadgetTitle={gadgetTitle}
                />
            );
        }

        return (
            <Sortable
                className="dashboard-gadgets"
                provideDropRef
                provideDragRef
                items={widgets}
                itemType="gadget"
                onChange={gadgetReordered}
            >
                {(widget, index, dragDropProps) => renderGadget(widget, index, dragDropProps)}
            </Sortable>
        );
    };

    const onShowGadgets = () => setShowGadgetPanel(true);

    const hideGadgetDialog = () => {
        setShowGadgetPanel(false);
        saveDashboardInfo();
    };

    const worklogAdded = (e: any) => {
        emitToChildren(e, -1);
        hideWorklog();
    };

    const hideWorklog = () => setShowWorklogPopup(false);

    const tabViewChanged = (newIsTabView: boolean) => {
        setIsTabView(newIsTabView);
    };

    const layoutModeChanged = useCallback((mode: number) => {
        const board = currentBoardRef.current;
        if (!board) return;

        const updatedBoard: DashboardType = { ...board, layout: mode };

        // Seed placements on the first switch so gadgets do not all land on top of each other
        if (mode === DashboardLayoutMode.Grid && !updatedBoard.layouts) {
            updatedBoard.layouts = generateLayouts(updatedBoard.widgets || []);
        }

        updateCurrentBoard(updatedBoard);
        saveDashboardInfo(updatedBoard);
        setGridEditMode(mode === DashboardLayoutMode.Grid);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const resetGridLayout = useCallback(() => {
        const board = currentBoardRef.current;
        if (!board) return;

        const updatedBoard: DashboardType = { ...board, layouts: generateLayouts(board.widgets || []) };
        updateCurrentBoard(updatedBoard);
        saveDashboardInfo(updatedBoard);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const tidyGridLayout = useCallback(() => {
        const board = currentBoardRef.current;
        if (!board?.layouts) return;

        const updatedBoard: DashboardType = { ...board, layouts: compactLayouts(board.layouts) };
        updateCurrentBoard(updatedBoard);
        saveDashboardInfo(updatedBoard);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!currentBoard) {
        return <div className="p-4 text-secondary">Loading dashboard...</div>;
    }

    return (
        <>
            {!quickView && (
                <AddGadget
                    show={showGadgetPanel}
                    onHide={hideGadgetDialog}
                    addedGadgets={currentBoard.widgets || []}
                    addGadget={addGadget}
                    removeGadget={removeGadget}
                />
            )}
            <div className="page-container dashboard-container w-full p-2">
                {!quickView && (
                    <DashboardHeader
                        config={currentBoard}
                        index={dashboardIndex}
                        userId={$session.userId?.toString()!}
                        onShowGadgets={onShowGadgets}
                        tabViewChanged={tabViewChanged}
                        layoutModeChanged={layoutModeChanged}
                        resetGridLayout={resetGridLayout}
                        tidyGridLayout={tidyGridLayout}
                        isGrid={isGrid}
                        gridEditMode={gridEditMode}
                        onGridEditModeChange={setGridEditMode}
                        isQuickView={quickView}
                    />
                )}
                {renderGadgets()}
            </div>
            {showWorklogPopup && <AddWorklog worklog={worklogItem} onDone={worklogAdded} onHide={hideWorklog} />}
        </>
    );
}
