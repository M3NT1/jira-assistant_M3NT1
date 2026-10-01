import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWorklogStore } from '@/stores/worklog-store';

import { inject } from '@services';

import { Button } from '@components';

import { getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import Link from '../controls/Link';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

interface TodayState {
    loggedSecs: number;
    pendingSecs: number;
    pendingCount: number;
    entryCount: number;
    ticketCount: number;
    topTickets: Array<{ ticketNo: string; secs: number; summary?: string }>;
}

const emptyState: TodayState = {
    loggedSecs: 0,
    pendingSecs: 0,
    pendingCount: 0,
    entryCount: 0,
    ticketCount: 0,
    topTickets: [],
};

function formatHours(secs: number): string {
    if (!secs) {
        return '0h';
    }
    const hours = Math.floor(secs / 3600);
    const mins = Math.round((secs % 3600) / 60);
    if (!hours) {
        return `${mins}m`;
    }
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export default function TodaySummary(props: BaseGadgetProps) {
    const [state, setState] = useState<TodayState>(emptyState);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.TodaySummary,
        hideExport: true,
    });

    const { setIsLoading, addWorklog } = gadgetHook;
    const { curState } = useWorklogStore();

    const { $worklog, $session, $userutils } = inject('WorklogService', 'SessionService', 'UserUtilsService');

    const today = useMemo(() => new Date(), []);
    const expectedHours = useMemo(() => $userutils.getExpectedHours(today), [$userutils, today]);
    const nonWorkingDay = useMemo(() => $userutils.getNonWorkingDay(today), [$userutils, today]);
    const maxHours = ($session.CurrentUser?.maxHours as number) || 8;

    const refreshData = useCallback(() => {
        setIsLoading(true);

        $worklog
            .getWorklogs({ fromDate: getStartOfDay(new Date()), toDate: getEndOfDay(new Date()) })
            .then((worklogs: any[]) => {
                const byTicket = new Map<string, { ticketNo: string; secs: number; summary?: string }>();
                let loggedSecs = 0;
                let pendingSecs = 0;
                let pendingCount = 0;

                worklogs.forEach((wl) => {
                    const secs = wl.totalSecs || 0;
                    loggedSecs += secs;

                    if (!wl.isUploaded && !wl.worklogId) {
                        pendingSecs += secs;
                        pendingCount++;
                    }

                    const existing = byTicket.get(wl.ticketNo);
                    if (existing) {
                        existing.secs += secs;
                    } else {
                        byTicket.set(wl.ticketNo, { ticketNo: wl.ticketNo, secs, summary: wl.summary });
                    }
                });

                const topTickets = [...byTicket.values()].sort((a, b) => b.secs - a.secs).slice(0, 5);

                setState({
                    loggedSecs,
                    pendingSecs,
                    pendingCount,
                    entryCount: worklogs.length,
                    ticketCount: byTicket.size,
                    topTickets,
                });
            })
            .finally(() => setIsLoading(false));
    }, [$worklog, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    const loggedHours = state.loggedSecs / 3600;
    const target = expectedHours || 0;
    const remaining = Math.max(0, target - loggedHours);
    const isOver = loggedHours > maxHours;
    const progressPerc = target > 0 ? Math.min(100, (loggedHours / target) * 100) : loggedHours > 0 ? 100 : 0;

    const barColour = useMemo(() => {
        if (isOver) return 'bg-red-500';
        if (target > 0 && loggedHours >= target) return 'bg-green-500';
        if (loggedHours > 0) return 'bg-amber-500';
        return 'bg-gray-300 dark:bg-gray-600';
    }, [isOver, target, loggedHours]);

    const statusText = useMemo(() => {
        if (nonWorkingDay && !nonWorkingDay.isHalfDay) {
            return `${nonWorkingDay.type === 'leave' ? 'Leave' : 'Holiday'} today${nonWorkingDay.name ? ` — ${nonWorkingDay.name}` : ''}. No time expected.`;
        }
        if (isOver) {
            return `Over the ${maxHours}h daily maximum by ${formatHours(state.loggedSecs - maxHours * 3600)}.`;
        }
        if (target > 0 && loggedHours >= target) {
            return 'Daily target reached.';
        }
        return `${formatHours(remaining * 3600)} left to reach the ${formatHours(target * 3600)} target.`;
    }, [nonWorkingDay, isOver, maxHours, state.loggedSecs, target, loggedHours, remaining]);

    return (
        <GadgetContainer {...props} gadgetHook={gadgetHook} refreshData={refreshData}>
            <div className="flex flex-col gap-4 p-3">
                <div>
                    <div className="flex items-end justify-between gap-2 mb-1.5">
                        <div>
                            <span className="text-3xl font-semibold tabular-nums">{formatHours(state.loggedSecs)}</span>
                            {target > 0 && <span className="text-sm text-secondary ml-1.5">/ {formatHours(target * 3600)}</span>}
                        </div>
                        <Button
                            variant="primary"
                            leftIcon={<i className="fa fa-plus" />}
                            onClick={() => addWorklog({ dateStarted: new Date() })}
                            size="sm"
                            label="Log time"
                        />
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${barColour}`}
                            style={{ width: `${progressPerc}%` }}
                        />
                    </div>
                    <div className="text-xs text-secondary mt-1.5">{statusText}</div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-(--bg-secondary) py-2">
                        <div className="text-lg font-semibold tabular-nums">{state.entryCount}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Entries</div>
                    </div>
                    <div className="rounded-lg bg-(--bg-secondary) py-2">
                        <div className="text-lg font-semibold tabular-nums">{state.ticketCount}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Tickets</div>
                    </div>
                    <div
                        className={`rounded-lg py-2 ${state.pendingCount ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-(--bg-secondary)'}`}
                        title={
                            state.pendingCount
                                ? 'Entries not yet uploaded to Jira. Use the "Worklog - [Pending Upload]" gadget to upload them.'
                                : undefined
                        }
                    >
                        <div className="text-lg font-semibold tabular-nums">{state.pendingCount}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Pending</div>
                    </div>
                </div>

                {curState?.key && (
                    <div className="flex items-center gap-2 text-xs rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-3 py-2">
                        <i className={`fa fa-${curState.isRunning ? 'play' : 'pause'} text-blue-600 dark:text-blue-300`} />
                        <span className="text-secondary">Timer {curState.isRunning ? 'running' : 'paused'} on</span>
                        <Link className="font-semibold" href={$userutils.getTicketUrl(curState.key) || ''}>
                            {curState.key}
                        </Link>
                    </div>
                )}

                {!!state.topTickets.length && (
                    <div>
                        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Where today went</div>
                        <div className="flex flex-col gap-1">
                            {state.topTickets.map((t) => (
                                <div key={t.ticketNo} className="flex items-center gap-2 text-sm">
                                    <Link className="font-medium shrink-0" href={$userutils.getTicketUrl(t.ticketNo) || ''}>
                                        {t.ticketNo}
                                    </Link>
                                    <span className="text-xs text-secondary truncate flex-1" title={t.summary}>
                                        {t.summary}
                                    </span>
                                    <span className="tabular-nums text-xs font-medium shrink-0">{formatHours(t.secs)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!state.entryCount && (
                    <div className="text-sm text-secondary italic text-center py-2">
                        Nothing logged today yet.
                    </div>
                )}
            </div>
        </GadgetContainer>
    );
}
