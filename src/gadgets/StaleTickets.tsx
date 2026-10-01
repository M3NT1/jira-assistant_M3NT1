import { useCallback, useEffect, useMemo, useState } from 'react';

import { inject } from '@services';

import { Dropdown, showContextMenu } from '@components';

import { GadgetActionType } from '@constants';

import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';
import { Image } from '../controls';
import Link from '../controls/Link';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

interface StaleRow {
    ticketNo: string;
    ticketUrl: string;
    summary: string;
    issuetype: string;
    issuetypeIcon?: string;
    status: string;
    priority: string;
    priorityIcon?: string;
    idleDays: number;
    updated: string;
    updatedSortable: string;
}

const thresholdList = [
    { value: 7, label: 'Idle 7+ days' },
    { value: 14, label: 'Idle 14+ days' },
    { value: 30, label: 'Idle 30+ days' },
    { value: 60, label: 'Idle 60+ days' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function idleClass(days: number): string {
    if (days > 30) {
        return 'text-red-600 dark:text-red-400 font-semibold';
    }
    if (days > 14) {
        return 'text-amber-600 dark:text-amber-400 font-semibold';
    }
    return '';
}

function formatIdle(days: number): string {
    if (days < 1) {
        return 'today';
    }
    return days === 1 ? '1 day' : `${days} days`;
}

export default function StaleTickets(props: BaseGadgetProps) {
    const [rows, setRows] = useState<StaleRow[]>([]);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.StaleTickets,
        hideExport: false,
    });

    const { setIsLoading, addWorklog, settingsRef, saveSettings } = gadgetHook;

    const [staleDays, setStaleDays] = useState<number>(settingsRef.current.staleDays || 14);

    const { $jira, $userutils, $jaBrowserExtn } = inject('JiraService', 'UserUtilsService', 'AppBrowserService');

    const refreshData = useCallback(() => {
        setIsLoading(true);

        // Plain JQL with a relative date so it behaves the same on Jira Server / Data Center
        const jql = `assignee = currentUser() AND resolution = Unresolved AND updatedDate <= '-${staleDays}d' ORDER BY updated ASC`;

        $jira
            .searchTickets(jql, ['summary', 'status', 'priority', 'issuetype', 'updated', 'created'], undefined, {
                maxResults: 100,
                ignoreWarnings: true,
            })
            .then((issues: any[]) => {
                const now = Date.now();

                const result: StaleRow[] = issues.map((t: any) => {
                    const fields = t.fields || {};
                    const updatedTime = fields.updated ? new Date(fields.updated).getTime() : NaN;
                    const idleDays = Number.isNaN(updatedTime) ? 0 : Math.floor((now - updatedTime) / MS_PER_DAY);

                    return {
                        ticketNo: t.key,
                        ticketUrl: $userutils.getTicketUrl(t.key) || '',
                        summary: fields.summary || '',
                        issuetype: fields.issuetype?.name || '',
                        issuetypeIcon: fields.issuetype?.iconUrl,
                        status: fields.status?.name || '',
                        priority: fields.priority?.name || '',
                        priorityIcon: fields.priority?.iconUrl,
                        idleDays,
                        updated: fields.updated ? $userutils.formatDateTime(fields.updated) : '',
                        updatedSortable: fields.updated || '',
                    };
                });

                setRows(result);
            })
            .catch((err: any) => {
                console.error('Unable to load stale tickets', err);
                setRows([]);
            })
            .finally(() => setIsLoading(false));
    }, [$jira, $userutils, staleDays, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

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

    const thresholdSelected = useCallback(
        (value: number) => {
            settingsRef.current.staleDays = value;
            setStaleDays(value);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const showRowContext = useCallback(
        (e: React.MouseEvent, row: StaleRow) => {
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
            <Dropdown className="w-36" size="sm" value={staleDays} options={thresholdList} onChange={(e) => thresholdSelected(e.value)} />
        ),
        [staleDays, thresholdSelected],
    );

    const hint = (
        <div className="max-w-xs text-xs">
            Your unresolved tickets with no change of any kind for the selected number of days. "Idle for" is calculated from the ticket's
            last updated timestamp. Right click a row to log time or open it in Jira.
        </div>
    );

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={rows.length ? `${rows.length} forgotten` : undefined}
        >
            <ScrollableTable dataset={rows} exportSheetName="Stale tickets">
                <THead>
                    <tr>
                        <Column sortBy="ticketNo">Ticket</Column>
                        <Column sortBy="issuetype">Type</Column>
                        <Column sortBy="summary">Summary</Column>
                        <Column sortBy="status">Status</Column>
                        <Column sortBy="priority">Priority</Column>
                        <Column sortBy="idleDays">Idle for</Column>
                        <Column sortBy="updatedSortable">Updated</Column>
                    </tr>
                </THead>
                <TBody>
                    {(row: StaleRow) => (
                        <tr key={row.ticketNo} data-test-id={row.ticketNo} onContextMenu={(e) => showRowContext(e, row)}>
                            <td className="whitespace-nowrap">
                                <i className="fa fa-ellipsis-v mr-2 cursor-pointer" onClick={(e) => showRowContext(e, row)} />
                                <Link href={row.ticketUrl} className="link">
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
                            <td className="whitespace-nowrap">
                                {row.priorityIcon && <Image src={row.priorityIcon} />}
                                {row.priority}
                            </td>
                            <td className={`whitespace-nowrap tabular-nums ${idleClass(row.idleDays)}`}>{formatIdle(row.idleDays)}</td>
                            <td className="whitespace-nowrap">{row.updated}</td>
                        </tr>
                    )}
                </TBody>
                <NoDataRow span={7}>
                    None of your open tickets have been sitting still that long. Lower the threshold to widen the search.
                </NoDataRow>
            </ScrollableTable>
        </GadgetContainer>
    );
}
