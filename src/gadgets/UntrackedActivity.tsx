import { useCallback, useEffect, useMemo, useState } from 'react';

import { addDays } from 'date-fns';

import { inject } from '@services';

import { Button } from '@components';

import { formatDate, getEndOfDay, getStartOfDay, getUserName } from '@utils';

import { GadgetActionType } from '@constants';

import DateRangePicker from '../controls/DateRangePicker';
import Link from '../controls/Link';
import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

interface UntrackedRow {
    id: string;
    ticketNo: string;
    ticketUrl?: string;
    summary: string;
    dateKey: string;
    dateDisplay: string;
    date: Date;
    /** Human readable list of what happened that day, e.g. "status, comment" */
    activity: string;
    activityCount: number;
}

/**
 * Fields whose changes signal that real work happened on the ticket. Field ids differ
 * between Cloud and Server, so both the id and the display name are matched.
 */
const WORK_SIGNAL_FIELDS = ['status', 'resolution', 'assignee', 'Comment', 'comment', 'description', 'Sprint', 'timespent'];

function describeField(field: string): string {
    const normalised = field?.toLowerCase();
    switch (normalised) {
        case 'status':
            return 'status change';
        case 'resolution':
            return 'resolved';
        case 'assignee':
            return 'assigned';
        case 'comment':
            return 'comment';
        case 'description':
            return 'description edit';
        case 'sprint':
            return 'sprint change';
        default:
            return normalised || 'update';
    }
}

export default function UntrackedActivity(props: BaseGadgetProps) {
    const [rows, setRows] = useState<UntrackedRow[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.UntrackedActivity,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings, addWorklog } = gadgetHook;

    const { $jira, $worklog, $session, $userutils } = inject('JiraService', 'WorklogService', 'SessionService', 'UserUtilsService');

    const initialRange = useMemo(() => {
        const stored = settingsRef.current.dateRange;
        if (stored?.fromDate && stored?.toDate) {
            return { fromDate: new Date(stored.fromDate), toDate: new Date(stored.toDate), quickDate: stored.quickDate };
        }
        const now = new Date();
        return { fromDate: addDays(now, -6), toDate: now, quickDate: undefined as string | number | undefined };
    }, [settingsRef]);

    const [range, setRange] = useState(initialRange);

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const collected: string[] = [];

        const fromDate = getStartOfDay(range.fromDate);
        const toDate = getEndOfDay(range.toDate);
        const currentUserName = (getUserName($session.CurrentUser as any, true) || '').toLowerCase();

        // Tickets I am involved with that moved during the period. Deliberately plain
        // JQL so it works the same on Jira Server / Data Center and Cloud.
        const fromStr = formatDate(fromDate, 'yyyy-MM-dd');
        const toStr = formatDate(addDays(toDate, 1), 'yyyy-MM-dd');
        const jql =
            `(assignee = currentUser() OR reporter = currentUser()) ` +
            `AND updatedDate >= '${fromStr}' AND updatedDate < '${toStr}' ORDER BY updated DESC`;

        // Capped on purpose: the changelog of every matched ticket has to be fetched,
        // which gets expensive fast on a busy Server instance
        const ticketLimit = 200;

        (async () => {
            try {
                const issues = await $jira.searchTickets(jql, ['summary'], undefined, {
                    maxResults: ticketLimit,
                    ignoreWarnings: true,
                });

                if (issues.length >= ticketLimit) {
                    collected.push(
                        `Only the ${ticketLimit} most recently updated tickets were checked. Narrow the date range to cover everything.`,
                    );
                }

                if (!issues.length) {
                    setRows([]);
                    return;
                }

                const summaryByKey = new Map<string, string>();
                issues.forEach((i: any) => summaryByKey.set(i.key, i.fields?.summary || ''));

                const [changelogs, worklogs] = await Promise.all([
                    $jira.getBulkIssueChangelogs(issues.map((i: any) => i.key)),
                    $worklog.getWorklogs({ fromDate, toDate }),
                ]);

                // Ticket+day pairs that already have logged time
                const loggedPairs = new Set<string>();
                worklogs.forEach((wl: any) => {
                    const started = wl.dateStarted instanceof Date ? wl.dateStarted : new Date(wl.dateStarted);
                    loggedPairs.add(`${wl.ticketNo}|${formatDate(started, 'yyyy-MM-dd')}`);
                });

                const fromTime = fromDate.getTime();
                const toTime = toDate.getTime();
                const activityMap = new Map<string, { ticketNo: string; date: Date; fields: Set<string>; count: number }>();
                let sawAnyChangelog = false;

                summaryByKey.forEach((_summary, key) => {
                    const logs = changelogs[key];
                    if (!logs?.length) {
                        return;
                    }
                    sawAnyChangelog = true;

                    logs.forEach((log: any) => {
                        const author = getUserName(log.author || {}, true);
                        if (!author || author.toLowerCase() !== currentUserName) {
                            return;
                        }

                        const created = new Date(log.created);
                        const time = created.getTime();
                        if (Number.isNaN(time) || time < fromTime || time > toTime) {
                            return;
                        }

                        const field = log.field || log.fieldId || '';
                        if (!WORK_SIGNAL_FIELDS.some((f) => f.toLowerCase() === String(field).toLowerCase())) {
                            return;
                        }

                        const dayKey = formatDate(created, 'yyyy-MM-dd');
                        const pairKey = `${key}|${dayKey}`;

                        if (loggedPairs.has(pairKey)) {
                            return;
                        }

                        const existing = activityMap.get(pairKey);
                        if (existing) {
                            existing.fields.add(describeField(String(field)));
                            existing.count++;
                        } else {
                            activityMap.set(pairKey, {
                                ticketNo: key,
                                date: getStartOfDay(created),
                                fields: new Set([describeField(String(field))]),
                                count: 1,
                            });
                        }
                    });
                });

                if (!sawAnyChangelog && issues.length) {
                    collected.push(
                        'Change history could not be read for these tickets. Your Jira account may lack the browse / view-history permission needed to read issue change logs.',
                    );
                }

                const result: UntrackedRow[] = [...activityMap.entries()]
                    .map(([pairKey, value]) => ({
                        id: pairKey,
                        ticketNo: value.ticketNo,
                        ticketUrl: $userutils.getTicketUrl(value.ticketNo),
                        summary: summaryByKey.get(value.ticketNo) || '',
                        dateKey: formatDate(value.date, 'yyyy-MM-dd'),
                        dateDisplay: $userutils.formatDate(value.date),
                        date: value.date,
                        activity: [...value.fields].join(', '),
                        activityCount: value.count,
                    }))
                    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.ticketNo.localeCompare(b.ticketNo));

                setRows(result);
            } catch (err: any) {
                console.error('Unable to detect untracked activity', err);
                collected.push('Unable to load activity. Check the console for details.');
                setRows([]);
            } finally {
                setWarnings(collected);
                setIsLoading(false);
            }
        })();
    }, [$jira, $worklog, $session, $userutils, range, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

    useEffect(() => {
        const handler = (action: any) => {
            if (
                action?.type === GadgetActionType.AddWorklog ||
                action?.type === GadgetActionType.DeletedWorklog ||
                action?.type === GadgetActionType.WorklogModified
            ) {
                refreshData();
            }
        };
        dashboardEventEmitter.on('change', handler);
        return () => {
            dashboardEventEmitter.removeListener('change', handler);
        };
    }, [refreshData]);

    const dateSelected = useCallback(
        (e: any) => {
            const [fromDate, toDate] = e.value || [];
            if (!fromDate || !toDate) {
                return;
            }
            const newRange = { fromDate, toDate, quickDate: e.range };
            settingsRef.current.dateRange = newRange;
            setRange(newRange);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const customActions = useMemo(
        () => <DateRangePicker value={[range.fromDate, range.toDate]} onChange={dateSelected} classNames={{ container: 'w-56' }} />,
        [range, dateSelected],
    );

    const hint = (
        <div className="max-w-xs text-xs">
            Compares your Jira change history (status moves, comments, assignments) against your worklogs and lists the ticket-day
            combinations where you were active but logged no time. Useful at the end of the week to catch forgotten entries.
        </div>
    );

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={rows.length ? `${rows.length} to review` : undefined}
        >
            {!!warnings.length && (
                <div className="mx-3 mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    {warnings.map((w) => (
                        <div key={w}>{w}</div>
                    ))}
                </div>
            )}
            <ScrollableTable dataset={rows} exportSheetName="Untracked activity">
                <THead>
                    <tr>
                        <Column sortBy="dateKey">Date</Column>
                        <Column sortBy="ticketNo">Ticket</Column>
                        <Column sortBy="summary">Summary</Column>
                        <Column sortBy="activity">Activity</Column>
                        <Column className="w-24" noExport>
                            Action
                        </Column>
                    </tr>
                </THead>
                <TBody>
                    {(row: UntrackedRow) => (
                        <tr key={row.id}>
                            <td className="whitespace-nowrap">{row.dateDisplay}</td>
                            <td>
                                <Link href={row.ticketUrl || ''} className="link">
                                    {row.ticketNo}
                                </Link>
                            </td>
                            <td className="truncate max-w-xs" title={row.summary}>
                                {row.summary}
                            </td>
                            <td className="text-xs text-secondary">{row.activity}</td>
                            <td>
                                <Button
                                    layout="outlined"
                                    variant="primary"
                                    leftIcon={<i className="fa fa-clock" />}
                                    onClick={() => addWorklog({ ticketNo: row.ticketNo, dateStarted: row.date })}
                                    size="sm"
                                    label="Log"
                                    title={`Log time on ${row.ticketNo} for ${row.dateDisplay}`}
                                />
                            </td>
                        </tr>
                    )}
                </TBody>
                <NoDataRow span={5}>
                    No untracked activity found for this period — everything you touched has logged time against it.
                </NoDataRow>
            </ScrollableTable>
        </GadgetContainer>
    );
}
