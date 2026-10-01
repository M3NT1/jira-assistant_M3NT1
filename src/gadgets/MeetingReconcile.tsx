import { useCallback, useEffect, useMemo, useState } from 'react';

import { inject } from '@services';

import { Button } from '@components';

import { getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

/** Shape returned by both CalendarService.getEvents and OutlookService.getEvents */
interface CalendarMeeting {
    id: string;
    start: Date;
    end: Date;
    title?: string;
    url?: string;
    allDay?: boolean;
    source?: string;
}

interface MeetingRow {
    id: string;
    title: string;
    start: Date;
    startSortable: number;
    timeRange: string;
    minutes: number;
    duration: string;
    timeSpent: string;
}

function formatMinutes(mins: number): string {
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    if (!hours) {
        return `${rest}m`;
    }
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function toTimeSpent(mins: number): string {
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export default function MeetingReconcile(props: BaseGadgetProps) {
    const [rows, setRows] = useState<MeetingRow[]>([]);
    const [warning, setWarning] = useState<string | null>(null);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.MeetingReconcile,
        hideExport: false,
    });

    const { setIsLoading, addWorklog } = gadgetHook;

    const { $calendar, $outlook, $worklog, $session, $userutils } = inject(
        'CalendarService',
        'OutlookService',
        'WorklogService',
        'SessionService',
        'UserUtilsService',
    );

    // googleIntegration / outlookIntegration are user settings not present on the SessionUser type
    const currentUser = $session.CurrentUser as any;
    const googleEnabled = !!(currentUser?.googleIntegration && currentUser?.hasGoogleCredentials);
    const outlookEnabled = !!(currentUser?.outlookIntegration && currentUser?.hasOutlookCredentials);
    const isConfigured = googleEnabled || outlookEnabled;

    const meetingTicket = useMemo(() => {
        // The setting is a comma separated list; a default is only safe when it holds exactly one key
        const tickets = (currentUser?.meetingTicket || '')
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean);
        return tickets.length === 1 ? (tickets[0] as string) : undefined;
    }, [currentUser?.meetingTicket]);

    const refreshData = useCallback(() => {
        if (!isConfigured) {
            setRows([]);
            return;
        }

        setIsLoading(true);
        setWarning(null);

        const fromDate = getStartOfDay(new Date());
        const toDate = getEndOfDay(new Date());

        (async () => {
            try {
                const sources: Array<{ name: string; request: Promise<any[]> }> = [];

                if (googleEnabled) {
                    sources.push({ name: 'Google', request: $calendar.getEvents(fromDate, toDate) });
                }

                if (outlookEnabled) {
                    sources.push({ name: 'Outlook', request: $outlook.getEvents(fromDate, toDate) });
                }

                const [meetingResults, worklogs] = await Promise.all([
                    Promise.allSettled(sources.map((s) => s.request)),
                    $worklog.getWorklogs({ fromDate, toDate }),
                ]);

                const meetings: CalendarMeeting[] = [];
                const failed: string[] = [];

                meetingResults.forEach((result, i) => {
                    if (result.status === 'fulfilled') {
                        meetings.push(...((result.value || []) as CalendarMeeting[]));
                    } else {
                        failed.push(sources[i].name);
                        console.error(`Unable to fetch ${sources[i].name} meetings`, result.reason);
                    }
                });

                if (failed.length) {
                    setWarning(`${failed.join(' and ')} meetings could not be loaded. You may need to reauthenticate under Settings.`);
                }

                const loggedParentIds = new Set<number>();
                const descriptions: string[] = [];

                (worklogs as any[]).forEach((wl) => {
                    if (typeof wl.parentId === 'number' && !Number.isNaN(wl.parentId)) {
                        loggedParentIds.add(wl.parentId);
                    }
                    if (wl.description) {
                        descriptions.push(String(wl.description).toLowerCase());
                    }
                });

                const unlogged = meetings
                    .filter((m) => {
                        if (m.allDay || !m.start || !m.end) {
                            return false;
                        }

                        const numericId = parseInt(m.id, 10);
                        if (!Number.isNaN(numericId) && loggedParentIds.has(numericId)) {
                            return false;
                        }

                        const title = (m.title || '').trim().toLowerCase();
                        if (title && descriptions.some((d) => d.includes(title))) {
                            return false;
                        }

                        return true;
                    })
                    .map((m) => {
                        const start = m.start instanceof Date ? m.start : new Date(m.start);
                        const end = m.end instanceof Date ? m.end : new Date(m.end);
                        const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

                        return {
                            id: m.id,
                            title: m.title || '(no title)',
                            start,
                            startSortable: start.getTime(),
                            timeRange: `${$userutils.formatTime(start)} - ${$userutils.formatTime(end)}`,
                            minutes,
                            duration: formatMinutes(minutes),
                            timeSpent: toTimeSpent(minutes),
                        };
                    })
                    .sort((a, b) => a.startSortable - b.startSortable);

                setRows(unlogged);
            } catch (err: any) {
                console.error('Unable to reconcile meetings with worklogs', err);
                setWarning('Unable to load meetings. Check the console for details.');
                setRows([]);
            } finally {
                setIsLoading(false);
            }
        })();
    }, [$calendar, $outlook, $worklog, $userutils, googleEnabled, outlookEnabled, isConfigured, setIsLoading]);

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

    const logMeeting = useCallback(
        (row: MeetingRow) => {
            addWorklog({
                dateStarted: row.start,
                timeSpent: row.timeSpent,
                description: row.title,
                ticketNo: meetingTicket,
            });
        },
        [addWorklog, meetingTicket],
    );

    const totalMinutes = useMemo(() => rows.reduce((sum, r) => sum + r.minutes, 0), [rows]);

    const hint = (
        <div className="max-w-xs text-xs">
            Today's calendar meetings that have no matching worklog yet. A meeting counts as logged once a worklog references it or repeats
            its title in the description. All day events are ignored.
        </div>
    );

    if (!isConfigured) {
        return (
            <GadgetContainer {...props} gadgetHook={gadgetHook} hint={hint}>
                <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                    <i className="fa fa-calendar-o text-2xl text-secondary" />
                    <div className="text-sm text-secondary">
                        No calendar is connected yet. Enable Google or Outlook meetings under Settings &rarr; Meetings and this gadget will
                        list the meetings you have not logged time for.
                    </div>
                </div>
            </GadgetContainer>
        );
    }

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            hint={hint}
            subTitle={totalMinutes ? `${formatMinutes(totalMinutes)} unlogged` : undefined}
        >
            {warning && (
                <div className="mx-3 mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    {warning}
                </div>
            )}
            <ScrollableTable dataset={rows} exportSheetName="Unlogged meetings">
                <THead>
                    <tr>
                        <Column sortBy="startSortable">Time</Column>
                        <Column sortBy="title">Meeting</Column>
                        <Column sortBy="minutes">Duration</Column>
                        <Column className="w-24" noExport>
                            Action
                        </Column>
                    </tr>
                </THead>
                <TBody>
                    {(row: MeetingRow) => (
                        <tr key={row.id}>
                            <td className="whitespace-nowrap tabular-nums">{row.timeRange}</td>
                            <td className="truncate max-w-xs" title={row.title}>
                                {row.title}
                            </td>
                            <td className="whitespace-nowrap tabular-nums">{row.duration}</td>
                            <td>
                                <Button
                                    layout="outlined"
                                    variant="primary"
                                    leftIcon={<i className="fa fa-clock" />}
                                    onClick={() => logMeeting(row)}
                                    size="sm"
                                    label="Log"
                                    title={`Log ${row.duration} against ${meetingTicket || 'a ticket you pick'}`}
                                />
                            </td>
                        </tr>
                    )}
                </TBody>
                <NoDataRow span={4}>Every meeting you attended today is already logged. Nothing to catch up on.</NoDataRow>
            </ScrollableTable>
        </GadgetContainer>
    );
}
