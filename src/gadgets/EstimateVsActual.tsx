import { useCallback, useEffect, useMemo, useState } from 'react';

import { inject } from '@services';

import { Checkbox, showContextMenu } from '@components';

import { GadgetActionType } from '@constants';

import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';
import { Image } from '../controls';
import Link from '../controls/Link';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

interface EstimateRow {
    ticketNo: string;
    ticketUrl?: string;
    summary: string;
    issuetype: string;
    issuetypeIcon?: string;
    status: string;
    /** Seconds — aggregate values are used so parent issues include their children */
    estimateSecs: number;
    spentSecs: number;
    remainingSecs: number;
    /** Percentage of the estimate consumed; null when nothing was estimated */
    consumedPerc: number | null;
    overrunSecs: number;
}

function formatDuration(secs: number): string {
    if (!secs) {
        return '—';
    }
    const hours = secs / 3600;
    if (hours < 1) {
        return `${Math.round(secs / 60)}m`;
    }
    if (hours < 10) {
        return `${hours.toFixed(1)}h`;
    }
    const days = hours / 8;
    return days >= 5 ? `${days.toFixed(1)}d` : `${Math.round(hours)}h`;
}

export default function EstimateVsActual(props: BaseGadgetProps) {
    const [rows, setRows] = useState<EstimateRow[]>([]);
    const [onlyEstimated, setOnlyEstimated] = useState<boolean>(true);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.EstimateVsActual,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings, addWorklog } = gadgetHook;

    const { $jira, $userutils, $jaBrowserExtn } = inject('JiraService', 'UserUtilsService', 'AppBrowserService');

    useEffect(() => {
        if (typeof settingsRef.current.onlyEstimated === 'boolean') {
            setOnlyEstimated(settingsRef.current.onlyEstimated);
        }
    }, [settingsRef]);

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';

        $jira
            .searchTickets(
                jql,
                [
                    'summary',
                    'issuetype',
                    'status',
                    'timeoriginalestimate',
                    'aggregatetimeoriginalestimate',
                    'timespent',
                    'aggregatetimespent',
                    'timeestimate',
                    'aggregatetimeestimate',
                ],
                undefined,
                // Capped to keep the dashboard responsive; the full picture lives in the reports
                { maxResults: 100, ignoreWarnings: true },
            )
            .then((issues: any[]) => {
                const result: EstimateRow[] = issues.map((issue) => {
                    const f = issue.fields || {};

                    // Aggregate figures roll up sub-tasks, which is what matters when
                    // judging whether a piece of work fits its estimate
                    const estimateSecs = f.aggregatetimeoriginalestimate || f.timeoriginalestimate || 0;
                    const spentSecs = f.aggregatetimespent || f.timespent || 0;
                    const remainingSecs = f.aggregatetimeestimate ?? f.timeestimate ?? 0;

                    return {
                        ticketNo: issue.key,
                        ticketUrl: $userutils.getTicketUrl(issue.key),
                        summary: f.summary || '',
                        issuetype: f.issuetype?.name || '',
                        issuetypeIcon: f.issuetype?.iconUrl,
                        status: f.status?.name || '',
                        estimateSecs,
                        spentSecs,
                        remainingSecs,
                        consumedPerc: estimateSecs ? Math.round((spentSecs / estimateSecs) * 100) : null,
                        overrunSecs: estimateSecs && spentSecs > estimateSecs ? spentSecs - estimateSecs : 0,
                    };
                });

                setRows(result);
            })
            .finally(() => setIsLoading(false));
    }, [$jira, $userutils, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const handler = (action: any) => {
            if (action?.type === GadgetActionType.WorklogModified || action?.type === GadgetActionType.DeletedWorklog) {
                refreshData();
            }
        };
        dashboardEventEmitter.on('change', handler);
        return () => {
            dashboardEventEmitter.removeListener('change', handler);
        };
    }, [refreshData]);

    const toggleOnlyEstimated = useCallback(
        (value: boolean) => {
            settingsRef.current.onlyEstimated = value;
            setOnlyEstimated(value);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const visibleRows = useMemo(() => (onlyEstimated ? rows.filter((r) => r.estimateSecs > 0) : rows), [rows, onlyEstimated]);

    const summary = useMemo(() => {
        const estimated = rows.filter((r) => r.estimateSecs > 0);
        const overrun = estimated.filter((r) => r.overrunSecs > 0);
        const totalOverrun = overrun.reduce((sum, r) => sum + r.overrunSecs, 0);
        return { estimatedCount: estimated.length, overrunCount: overrun.length, totalOverrun, unestimated: rows.length - estimated.length };
    }, [rows]);

    const showRowContext = useCallback(
        (e: React.MouseEvent, row: EstimateRow) => {
            showContextMenu(e, [
                { label: 'Add worklog', icon: 'fa fa-clock', command: () => addWorklog({ ticketNo: row.ticketNo }) },
                {
                    label: 'Open ticket',
                    icon: 'fa fa-external-link',
                    command: () => row.ticketUrl && $jaBrowserExtn.openTab(row.ticketUrl),
                },
            ]);
        },
        [addWorklog, $jaBrowserExtn],
    );

    const customActions = useMemo(
        () => (
            <Checkbox
                checked={onlyEstimated}
                onChange={(e) => toggleOnlyEstimated(e.value)}
                label="Estimated only"
                size="sm"
            />
        ),
        [onlyEstimated, toggleOnlyEstimated],
    );

    const hint = (
        <div className="max-w-xs text-xs">
            Compares the original estimate with time actually spent on your unresolved tickets. Aggregate values are used, so a parent issue
            includes the time booked on its sub-tasks.
        </div>
    );

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={summary.overrunCount ? `${summary.overrunCount} over estimate` : undefined}
        >
            <div className="px-3 pt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-(--bg-secondary) py-2">
                    <div className="text-lg font-semibold tabular-nums">{summary.estimatedCount}</div>
                    <div className="text-[11px] text-secondary uppercase tracking-wide">Estimated</div>
                </div>
                <div
                    className={`rounded-lg py-2 ${summary.overrunCount ? 'bg-red-100 dark:bg-red-900/30' : 'bg-(--bg-secondary)'}`}
                    title={summary.totalOverrun ? `${formatDuration(summary.totalOverrun)} beyond estimate in total` : undefined}
                >
                    <div className="text-lg font-semibold tabular-nums">{summary.overrunCount}</div>
                    <div className="text-[11px] text-secondary uppercase tracking-wide">Over estimate</div>
                </div>
                <div className="rounded-lg bg-(--bg-secondary) py-2">
                    <div className="text-lg font-semibold tabular-nums">{summary.unestimated}</div>
                    <div className="text-[11px] text-secondary uppercase tracking-wide">No estimate</div>
                </div>
            </div>

            <ScrollableTable dataset={visibleRows} exportSheetName="Estimate vs actual">
                <THead>
                    <tr>
                        <Column sortBy="ticketNo">Ticket</Column>
                        <Column sortBy="issuetype">Type</Column>
                        <Column sortBy="summary">Summary</Column>
                        <Column sortBy="status">Status</Column>
                        <Column sortBy="estimateSecs">Estimate</Column>
                        <Column sortBy="spentSecs">Spent</Column>
                        <Column sortBy="remainingSecs">Remaining</Column>
                        <Column sortBy="consumedPerc">Progress</Column>
                    </tr>
                </THead>
                <TBody>
                    {(row: EstimateRow) => {
                        const perc = row.consumedPerc;
                        const isOver = row.overrunSecs > 0;
                        const barWidth = perc === null ? 0 : Math.min(100, perc);
                        const barColour = isOver ? 'bg-red-500' : perc !== null && perc >= 80 ? 'bg-amber-500' : 'bg-green-500';

                        return (
                            <tr key={row.ticketNo} onContextMenu={(e) => showRowContext(e, row)}>
                                <td>
                                    <Link href={row.ticketUrl || ''} className="link">
                                        {row.ticketNo}
                                    </Link>
                                </td>
                                <td className="whitespace-nowrap">
                                    {row.issuetypeIcon && <Image src={row.issuetypeIcon} />}
                                    {row.issuetype}
                                </td>
                                <td className="truncate max-w-xs" title={row.summary}>
                                    {row.summary}
                                </td>
                                <td className="whitespace-nowrap">{row.status}</td>
                                <td className="tabular-nums">{formatDuration(row.estimateSecs)}</td>
                                <td className={`tabular-nums ${isOver ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                                    {formatDuration(row.spentSecs)}
                                </td>
                                <td className="tabular-nums">{formatDuration(row.remainingSecs)}</td>
                                <td>
                                    {perc === null ? (
                                        <span className="text-xs text-secondary italic">no estimate</span>
                                    ) : (
                                        <div className="flex items-center gap-2 min-w-28">
                                            <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                                <div className={`h-full rounded-full ${barColour}`} style={{ width: `${barWidth}%` }} />
                                            </div>
                                            <span
                                                className={`text-xs tabular-nums shrink-0 ${isOver ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-secondary'}`}
                                            >
                                                {perc}%
                                            </span>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    }}
                </TBody>
                <NoDataRow span={8}>
                    {onlyEstimated
                        ? 'None of your open tickets have an original estimate. Untick "Estimated only" to see them all.'
                        : 'No unresolved tickets are assigned to you.'}
                </NoDataRow>
            </ScrollableTable>
        </GadgetContainer>
    );
}
