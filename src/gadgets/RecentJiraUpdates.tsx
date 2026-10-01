import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { subDays } from 'date-fns';

import { inject } from '@services';

import { Button, Dropdown, SelectButton } from '@components';

import { formatDate, getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';
import Link from '../controls/Link';
import { UserDisplay } from '../display-controls';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

type ViewMode = 'others' | 'mine';

interface UpdateEntry {
    author: any;
    field?: string;
    fromString?: string;
    toString?: string;
    date: Date;
    dateDisplay: string;
}

interface UpdatedTicket {
    key: string;
    ticketUrl: string;
    summary: string;
    updates: UpdateEntry[];
    updateCount: number;
    lastUpdated: string;
    lastUpdatedTs: number;
}

/** One ticket on one day of my own activity, with the time booked on it that day */
interface ActivityRow {
    id: string;
    ticketNo: string;
    ticketUrl: string;
    summary: string;
    date: Date;
    dateKey: string;
    dateDisplay: string;
    changeCount: number;
    /** Distinct field changes, e.g. "status change, comment" */
    activity: string;
    loggedSecs: number;
    hasWorklog: boolean;
}

const periodList = [
    { value: 1, label: 'Last day' },
    { value: 3, label: 'Last 3 days' },
    { value: 7, label: 'Last 7 days' },
    { value: 14, label: 'Last 14 days' },
    { value: 30, label: 'Last 30 days' },
];

const modeList = [
    { value: 'mine', label: 'My activity' },
    { value: 'others', label: "Others' changes" },
];

function describeField(field?: string): string {
    const normalised = (field || '').toLowerCase();
    switch (normalised) {
        case 'status':
            return 'status';
        case 'resolution':
            return 'resolution';
        case 'assignee':
            return 'assignee';
        case 'comment':
            return 'comment';
        case 'description':
            return 'description';
        case 'timespent':
            return 'time spent';
        default:
            return field || 'field';
    }
}

function formatHours(secs: number): string {
    if (!secs) return '—';
    const hours = Math.floor(secs / 3600);
    const mins = Math.round((secs % 3600) / 60);
    if (!hours) return `${mins}m`;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export default function RecentJiraUpdates(props: BaseGadgetProps) {
    const [tickets, setTickets] = useState<UpdatedTicket[]>([]);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [totalUpdates, setTotalUpdates] = useState(0);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.RecentJiraUpdates,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings, addWorklog } = gadgetHook;

    const [days, setDays] = useState<number>(settingsRef.current.days || 7);
    const [mode, setMode] = useState<ViewMode>((settingsRef.current.mode as ViewMode) || 'mine');

    const { $jupdates, $userutils, $worklog } = inject('JiraUpdatesService', 'UserUtilsService', 'WorklogService');

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const isMine = mode === 'mine';
        const fromDate = getStartOfDay(subDays(new Date(), days - 1));
        const toDate = getEndOfDay(new Date());

        const updatesPromise = $jupdates.getRescentUpdates(days, { mine: isMine });
        // Worklogs are only needed to answer "did I book time for this?" in the my-activity view
        const worklogPromise = isMine ? $worklog.getWorklogs({ fromDate, toDate }) : Promise.resolve([]);

        Promise.all([updatesPromise, worklogPromise])
            .then(([result, worklogs]: [any, any[]]) => {
                setTotalUpdates(result?.total || 0);
                setExpanded({});

                if (!isMine) {
                    const list: UpdatedTicket[] = (result?.list || []).map((item: any) => {
                        const updates: UpdateEntry[] = (item.updates || []).map((u: any) => ({
                            author: u.author,
                            field: u.field,
                            fromString: u.fromString,
                            toString: u.toString,
                            date: u.date,
                            dateDisplay: $userutils.formatDateTime(u.date, 'quick'),
                        }));

                        return {
                            key: item.key,
                            ticketUrl: $userutils.getTicketUrl(item.key) || item.href || '',
                            summary: item.summary || '',
                            updates,
                            updateCount: updates.length,
                            lastUpdated: item.date ? $userutils.formatDateTime(item.date, 'quick') : '',
                            lastUpdatedTs: item.sortBy || (item.date ? new Date(item.date).getTime() : 0),
                        };
                    });

                    setTickets(list);
                    setActivity([]);
                    return;
                }

                // Seconds booked per ticket and day, so each activity row can be answered individually
                const secsByPair = new Map<string, number>();
                worklogs.forEach((wl: any) => {
                    const started = wl.dateStarted instanceof Date ? wl.dateStarted : new Date(wl.dateStarted);
                    const pair = `${wl.ticketNo}|${formatDate(started, 'yyyy-MM-dd')}`;
                    secsByPair.set(pair, (secsByPair.get(pair) || 0) + (wl.totalSecs || 0));
                });

                const grouped = new Map<string, { ticketNo: string; summary: string; date: Date; fields: Set<string>; count: number }>();

                (result?.list || []).forEach((item: any) => {
                    (item.updates || []).forEach((u: any) => {
                        const changed = u.date instanceof Date ? u.date : new Date(u.date);
                        if (Number.isNaN(changed.getTime())) {
                            return;
                        }

                        const dayKey = formatDate(changed, 'yyyy-MM-dd');
                        const pair = `${item.key}|${dayKey}`;
                        const existing = grouped.get(pair);

                        if (existing) {
                            existing.fields.add(describeField(u.field));
                            existing.count++;
                        } else {
                            grouped.set(pair, {
                                ticketNo: item.key,
                                summary: item.summary || '',
                                date: getStartOfDay(changed),
                                fields: new Set([describeField(u.field)]),
                                count: 1,
                            });
                        }
                    });
                });

                const rows: ActivityRow[] = [...grouped.entries()]
                    .map(([pair, value]) => {
                        const loggedSecs = secsByPair.get(pair) || 0;
                        return {
                            id: pair,
                            ticketNo: value.ticketNo,
                            ticketUrl: $userutils.getTicketUrl(value.ticketNo) || '',
                            summary: value.summary,
                            date: value.date,
                            dateKey: formatDate(value.date, 'yyyy-MM-dd'),
                            dateDisplay: $userutils.formatDate(value.date),
                            changeCount: value.count,
                            activity: [...value.fields].join(', '),
                            loggedSecs,
                            hasWorklog: loggedSecs > 0,
                        };
                    })
                    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.ticketNo.localeCompare(b.ticketNo));

                setActivity(rows);
                setTickets([]);
            })
            .catch((err: any) => {
                console.error('Unable to load recent Jira updates', err);
                setTickets([]);
                setActivity([]);
                setTotalUpdates(0);
            })
            .finally(() => setIsLoading(false));
    }, [$jupdates, $userutils, $worklog, days, mode, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

    useEffect(() => {
        if (mode !== 'mine') {
            return;
        }
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
    }, [mode, refreshData]);

    const toggleTicket = useCallback((key: string) => {
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const periodSelected = useCallback(
        (value: number) => {
            settingsRef.current.days = value;
            setDays(value);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const modeSelected = useCallback(
        (value: ViewMode) => {
            if (!value) {
                return;
            }
            settingsRef.current.mode = value;
            setMode(value);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const customActions = useMemo(
        () => (
            <div className="flex items-center gap-1.5">
                <SelectButton
                    items={modeList}
                    value={mode}
                    onChange={(e: any) => modeSelected(e.value as ViewMode)}
                    variant="segmented"
                    size="sm"
                />
                <Dropdown className="w-32" size="sm" value={days} options={periodList} onChange={(e) => periodSelected(e.value)} />
            </div>
        ),
        [mode, modeSelected, days, periodSelected],
    );

    const unloggedSummary = useMemo(() => {
        if (mode !== 'mine') {
            return null;
        }
        const unlogged = activity.filter((a) => !a.hasWorklog);
        const days = new Set(unlogged.map((a) => a.dateKey));
        return { count: unlogged.length, dayCount: days.size };
    }, [mode, activity]);

    const hint =
        mode === 'mine' ? (
            <div className="max-w-xs text-xs">
                Your own changes in Jira — status moves, comments, assignments — grouped by ticket and day, with the time you booked on that
                ticket that day. Rows without logged time are what you administered but never recorded. Involvement is matched on assignee,
                reporter or watcher, because Jira Server has no "changed by me" search operator.
            </div>
        ) : (
            <div className="max-w-xs text-xs">
                Changes other people made on tickets you are involved with, so you can catch up before the standup. Driven by the "Jira
                updates JQL" in Advanced Settings, and limited to changes you have not viewed yet.
            </div>
        );

    const subTitle = useMemo(() => {
        if (mode === 'mine') {
            if (!activity.length) {
                return undefined;
            }
            return unloggedSummary?.count
                ? `${unloggedSummary.count} without worklog on ${unloggedSummary.dayCount} day(s)`
                : 'all activity has logged time';
        }
        return totalUpdates ? `${totalUpdates} changes on ${tickets.length} tickets` : undefined;
    }, [mode, activity.length, unloggedSummary, totalUpdates, tickets.length]);

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={subTitle}
        >
            {mode === 'mine' ? (
                <ScrollableTable dataset={activity} exportSheetName="My Jira activity">
                    <THead>
                        <tr>
                            <Column sortBy="dateKey">Date</Column>
                            <Column sortBy="ticketNo">Ticket</Column>
                            <Column sortBy="summary">Summary</Column>
                            <Column sortBy="activity">Administered</Column>
                            <Column sortBy="changeCount">Changes</Column>
                            <Column sortBy="loggedSecs">Logged</Column>
                            <Column className="w-20" noExport>
                                Action
                            </Column>
                        </tr>
                    </THead>
                    <TBody>
                        {(row: ActivityRow) => (
                            <tr key={row.id} className={row.hasWorklog ? undefined : 'bg-amber-50 dark:bg-amber-900/20'}>
                                <td className="whitespace-nowrap">{row.dateDisplay}</td>
                                <td>
                                    <Link href={row.ticketUrl} className="link">
                                        {row.ticketNo}
                                    </Link>
                                </td>
                                <td className="truncate max-w-xs" title={row.summary}>
                                    {row.summary}
                                </td>
                                <td className="text-xs text-secondary">{row.activity}</td>
                                <td className="tabular-nums">{row.changeCount}</td>
                                <td className="whitespace-nowrap">
                                    {row.hasWorklog ? (
                                        <span className="text-green-700 dark:text-green-400 tabular-nums">
                                            <i className="fa fa-check mr-1" />
                                            {formatHours(row.loggedSecs)}
                                        </span>
                                    ) : (
                                        <span className="text-amber-700 dark:text-amber-400">
                                            <i className="fa fa-exclamation-triangle mr-1" />
                                            not logged
                                        </span>
                                    )}
                                </td>
                                <td>
                                    {!row.hasWorklog && (
                                        <Button
                                            layout="outlined"
                                            variant="primary"
                                            leftIcon={<i className="fa fa-clock" />}
                                            onClick={() => addWorklog({ ticketNo: row.ticketNo, dateStarted: row.date })}
                                            size="sm"
                                            label="Log"
                                            title={`Log time on ${row.ticketNo} for ${row.dateDisplay}`}
                                        />
                                    )}
                                </td>
                            </tr>
                        )}
                    </TBody>
                    <NoDataRow span={7}>
                        No activity of your own was found in this period. Note that this looks at tickets where you are the assignee,
                        reporter or a watcher.
                    </NoDataRow>
                </ScrollableTable>
            ) : (
                <ScrollableTable dataset={tickets} exportSheetName="Recent Jira updates">
                    <THead>
                        <tr>
                            <Column sortBy="key">Ticket</Column>
                            <Column sortBy="summary">Summary</Column>
                            <Column sortBy="updateCount">Changes</Column>
                            <Column sortBy="lastUpdatedTs">Last change</Column>
                        </tr>
                    </THead>
                    <TBody>
                        {(t: UpdatedTicket) => {
                            const isOpen = !!expanded[t.key];

                            return (
                                <Fragment key={t.key}>
                                    <tr
                                        className="cursor-pointer"
                                        onClick={() => toggleTicket(t.key)}
                                        title="Click to show the individual changes"
                                    >
                                        <td className="whitespace-nowrap">
                                            <i className={`fa fa-caret-${isOpen ? 'down' : 'right'} mr-2`} />
                                            <Link href={t.ticketUrl} className="link">
                                                {t.key}
                                            </Link>
                                        </td>
                                        <td className="truncate max-w-xs" title={t.summary}>
                                            {t.summary}
                                        </td>
                                        <td className="tabular-nums">{t.updateCount}</td>
                                        <td className="whitespace-nowrap">{t.lastUpdated}</td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="bg-(--bg-secondary)">
                                            <td colSpan={4} className="p-0">
                                                <div className="flex flex-col gap-1 px-8 py-2">
                                                    {t.updates.map((u, i) => (
                                                        <div key={i} className="text-xs flex flex-wrap items-baseline gap-1">
                                                            <UserDisplay tag="span" className="font-medium" user={u.author} />
                                                            <span className="text-secondary">changed</span>
                                                            <span className="font-medium">{u.field || 'a field'}</span>
                                                            <span className="text-secondary">from</span>
                                                            <span>{u.fromString || 'NONE'}</span>
                                                            <span className="text-secondary">to</span>
                                                            <span>{u.toString || 'NONE'}</span>
                                                            <span className="text-secondary">— {u.dateDisplay}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        }}
                    </TBody>
                    <NoDataRow span={4}>
                        Nothing changed on your tickets in this period. If you expect updates here, check that "Disable Jira updates" is off
                        and review the "Jira updates JQL" under Settings &rarr; Advanced.
                    </NoDataRow>
                </ScrollableTable>
            )}
        </GadgetContainer>
    );
}
