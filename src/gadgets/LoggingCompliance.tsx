import { useCallback, useEffect, useMemo, useState } from 'react';

import { startOfMonth } from 'date-fns';

import { inject } from '@services';

import { hideTooltip, showTooltip } from '@components';

import { formatDate, getDateArray, getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import DateRangePicker from '../controls/DateRangePicker';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

interface DayEntry {
    key: string;
    date: Date;
    dayOfMonth: number;
    weekDay: number;
    loggedSecs: number;
    expectedSecs: number;
    isFuture: boolean;
    isToday: boolean;
    /** Weekend, holiday or full-day leave — nothing expected */
    isOffDay: boolean;
    offLabel?: string;
}

type DayStatus = 'off' | 'future' | 'missing' | 'partial' | 'met' | 'over';

function getStatus(day: DayEntry): DayStatus {
    if (day.isOffDay) {
        return day.loggedSecs > 0 ? 'over' : 'off';
    }
    if (day.loggedSecs === 0) {
        return day.isFuture || day.isToday ? 'future' : 'missing';
    }
    if (day.loggedSecs >= day.expectedSecs) {
        return 'met';
    }
    return 'partial';
}

const statusStyle: Record<DayStatus, string> = {
    off: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
    future: 'bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 border border-dashed border-(--border-color)',
    missing: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800',
    partial: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800',
    met: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-800',
    over: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800',
};

function formatHours(secs: number): string {
    if (!secs) return '0';
    const hours = secs / 3600;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function formatHoursLong(secs: number): string {
    // Round the total first, so 59.5 minutes reads "1h" rather than "60m"
    const totalMins = Math.round(secs / 60);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (!hours) return `${mins}m`;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Signed, so the balance shows at a glance whether the range is ahead of or behind its expected hours */
function formatBalance(secs: number): string {
    const text = formatHoursLong(Math.abs(secs));
    if (text === '0m') return text;
    return `${secs > 0 ? '+' : '−'}${text}`;
}

const MaxBreakdownRows = 15;

/** The days behind the Missing figure, so it can be checked against the grid */
function MissingBreakdown({ days, totalSecs }: { days: DayEntry[]; totalSecs: number }) {
    if (!days.length) {
        return <div className="text-xs">Every closed working day in this range met its expected hours.</div>;
    }

    const shown = days.slice(0, MaxBreakdownRows);

    return (
        <div className="text-xs tabular-nums">
            <div className="font-semibold mb-1">Missing per day</div>
            <table>
                <tbody>
                    {shown.map((d) => (
                        <tr key={d.key}>
                            <td className="pr-3">{formatDate(d.date, 'EEE, dd/MM')}</td>
                            <td className="pr-3 opacity-70">
                                {formatHoursLong(d.loggedSecs)} of {formatHoursLong(d.expectedSecs)}
                            </td>
                            <td className="text-right">{formatHoursLong(d.expectedSecs - d.loggedSecs)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {days.length > shown.length && <div className="opacity-70 mt-1">+{days.length - shown.length} more days</div>}
            <div className="flex justify-between gap-4 font-semibold border-t border-white/20 mt-1 pt-1">
                <span>Total</span>
                <span>{formatHoursLong(totalSecs)}</span>
            </div>
            <div className="opacity-70 mt-1 max-w-60">Days above their target do not make up for these; the balance does.</div>
        </div>
    );
}

interface BalanceParts {
    loggedSecs: number;
    expectedSecs: number;
    notDueSecs: number;
    balanceSecs: number;
}

/** The balance as a small ledger, so the sum behind it can be followed */
function BalanceBreakdown({ loggedSecs, expectedSecs, notDueSecs, balanceSecs }: BalanceParts) {
    return (
        <div className="text-xs tabular-nums">
            <table>
                <tbody>
                    <tr>
                        <td className="pr-4">Logged</td>
                        <td className="text-right">{formatHoursLong(loggedSecs)}</td>
                    </tr>
                    <tr>
                        <td className="pr-4">Expected</td>
                        <td className="text-right">
                            {expectedSecs > 0 && '−'}
                            {formatHoursLong(expectedSecs)}
                        </td>
                    </tr>
                    {notDueSecs > 0 && (
                        <tr>
                            <td className="pr-4">Rest of today, not due yet</td>
                            <td className="text-right">+{formatHoursLong(notDueSecs)}</td>
                        </tr>
                    )}
                    <tr className="font-semibold">
                        <td className="pr-4 pt-1 border-t border-white/20">Balance</td>
                        <td className="text-right pt-1 border-t border-white/20">{formatBalance(balanceSecs)}</td>
                    </tr>
                </tbody>
            </table>
            <div className="opacity-70 mt-1 max-w-60">Unlike Missing, days above their target make up for the short ones.</div>
        </div>
    );
}

const WEEK_DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Monday-first column index so the grid lines up week by week */
function columnIndex(weekDay: number): number {
    return (weekDay + 6) % 7;
}

export default function LoggingCompliance(props: BaseGadgetProps) {
    const [days, setDays] = useState<DayEntry[]>([]);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.LoggingCompliance,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings, addWorklog } = gadgetHook;

    const { $worklog, $userutils } = inject('WorklogService', 'UserUtilsService');

    const dateRange = useMemo(() => {
        const stored = settingsRef.current.dateRange;
        if (stored?.fromDate && stored?.toDate) {
            return { fromDate: new Date(stored.fromDate), toDate: new Date(stored.toDate), quickDate: stored.quickDate };
        }
        const now = new Date();
        return { fromDate: startOfMonth(now), toDate: now, quickDate: undefined as string | number | undefined };
    }, [settingsRef]);

    const [range, setRange] = useState(dateRange);

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const fromDate = getStartOfDay(range.fromDate);
        const toDate = getEndOfDay(range.toDate);

        $worklog
            .getWorklogs({ fromDate, toDate })
            .then((worklogs: any[]) => {
                const secsByDay = new Map<string, number>();

                worklogs.forEach((wl) => {
                    const started = wl.dateStarted instanceof Date ? wl.dateStarted : new Date(wl.dateStarted);
                    const key = formatDate(started, 'yyyy-MM-dd');
                    secsByDay.set(key, (secsByDay.get(key) || 0) + (wl.totalSecs || 0));
                });

                const todayKey = formatDate(new Date(), 'yyyy-MM-dd');
                const now = new Date().getTime();

                const entries: DayEntry[] = getDateArray(fromDate, toDate).map((date) => {
                    const key = formatDate(date, 'yyyy-MM-dd');
                    const expectedHours = $userutils.getExpectedHours(date);
                    const nonWorking = $userutils.getNonWorkingDay(date);

                    return {
                        key,
                        date,
                        dayOfMonth: date.getDate(),
                        weekDay: date.getDay(),
                        loggedSecs: secsByDay.get(key) || 0,
                        expectedSecs: expectedHours * 3600,
                        isFuture: getStartOfDay(date).getTime() > now,
                        isToday: key === todayKey,
                        isOffDay: expectedHours === 0,
                        offLabel: nonWorking?.name || (nonWorking ? (nonWorking.type === 'leave' ? 'Leave' : 'Holiday') : undefined),
                    };
                });

                setDays(entries);
            })
            .finally(() => setIsLoading(false));
    }, [$worklog, $userutils, range, setIsLoading]);

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

    const summary = useMemo(() => {
        // Only closed days count as a shortfall: today and future days are still open
        const closed = days.filter((d) => !d.isOffDay && !d.isFuture && !d.isToday);
        const shortDays = closed.filter((d) => d.loggedSecs < d.expectedSecs);
        const shortfallSecs = shortDays.reduce((total, d) => total + d.expectedSecs - d.loggedSecs, 0);
        const missingDays = shortDays.filter((d) => d.loggedSecs === 0).length;
        const partialDays = shortDays.length - missingDays;
        const loggedSecs = days.reduce((total, d) => total + d.loggedSecs, 0);
        const expectedSecs = days.reduce((total, d) => total + (d.isFuture ? 0 : d.expectedSecs), 0);
        // The rest of today is not due until the day is over, the same rule Missing follows,
        // so an unfinished day does not pull the balance down every morning
        const notDueSecs = days.reduce((total, d) => (d.isToday ? total + Math.max(0, d.expectedSecs - d.loggedSecs) : total), 0);
        const balanceSecs = loggedSecs - expectedSecs + notDueSecs;

        return {
            shortDays,
            shortfallSecs,
            missingDays,
            partialDays,
            loggedSecs,
            expectedSecs,
            notDueSecs,
            balanceSecs,
            workingDays: closed.length,
        };
    }, [days]);

    const weeks = useMemo(() => {
        const result: DayEntry[][] = [];
        let current: DayEntry[] = [];

        days.forEach((day) => {
            const col = columnIndex(day.weekDay);
            if (!current.length) {
                // Pad the first week so the columns align with the weekday header
                for (let i = 0; i < col; i++) {
                    current.push(null as unknown as DayEntry);
                }
            }
            current.push(day);
            if (col === 6) {
                result.push(current);
                current = [];
            }
        });

        if (current.length) {
            result.push(current);
        }

        return result;
    }, [days]);

    const customActions = useMemo(
        () => (
            <DateRangePicker
                value={[range.fromDate, range.toDate]}
                onChange={dateSelected}
                classNames={{ container: 'w-56' }}
            />
        ),
        [range, dateSelected],
    );

    const hint = (
        <div className="max-w-xs text-xs">
            Days are compared against your expected hours (Settings &rarr; Worklog &rarr; minimum hours). Weekends, holidays and leave are
            excluded — configure them under Settings &rarr; Holidays. Today and future days are never counted as missing. Balance is
            logged minus expected over the whole range, so longer days make up for shorter ones; the rest of today is not due until the
            day is over.
        </div>
    );

    /**
     * Pointer and keyboard both open a card's explanation, so it is not mouse-only.
     * It closes as soon as the pointer leaves, like the chart tooltips, instead of lingering.
     */
    const cardTooltipProps = (content: React.ReactNode) => ({
        tabIndex: 0,
        onMouseEnter: (e: React.MouseEvent) => showTooltip(e, { content, placement: 'auto', timeout: 0 }),
        onMouseLeave: (e: React.MouseEvent) => {
            // A long list squeezed onto a small window can cover its own card; moving onto it must
            // not close it, or it would reopen under the pointer and flicker
            if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('.eui-tooltip'))) {
                hideTooltip({ timeout: 0 });
            }
        },
        onFocus: (e: React.FocusEvent) => showTooltip(e as unknown as React.MouseEvent, { content, placement: 'auto', timeout: 0 }),
        onBlur: () => hideTooltip({ timeout: 0 }),
    });

    const explainedCard = 'cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={summary.shortfallSecs > 0 ? `${formatHoursLong(summary.shortfallSecs)} missing` : 'up to date'}
        >
            <div className="flex flex-col gap-3 p-3">
                {/* Sized by the gadget's own width, since a dashboard column can be narrow on any screen */}
                <div className="@container">
                    <div className="grid grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-5 gap-2 text-center">
                        <div className="rounded-lg bg-(--bg-secondary) py-2">
                            <div className="text-lg font-semibold tabular-nums">{formatHoursLong(summary.loggedSecs)}</div>
                            <div className="text-[11px] text-secondary uppercase tracking-wide">Logged</div>
                        </div>
                        <div className="rounded-lg bg-(--bg-secondary) py-2">
                            <div className="text-lg font-semibold tabular-nums">{formatHoursLong(summary.expectedSecs)}</div>
                            <div className="text-[11px] text-secondary uppercase tracking-wide">Expected</div>
                        </div>
                        <div
                            className={`rounded-lg py-2 ${explainedCard} ${
                                summary.balanceSecs < 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'
                            }`}
                            {...cardTooltipProps(<BalanceBreakdown {...summary} />)}
                        >
                            <div className="text-lg font-semibold tabular-nums">{formatBalance(summary.balanceSecs)}</div>
                            <div className="text-[11px] text-secondary uppercase tracking-wide">Balance</div>
                        </div>
                        <div
                            className={`rounded-lg py-2 ${explainedCard} ${
                                summary.shortfallSecs > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'
                            }`}
                            {...cardTooltipProps(<MissingBreakdown days={summary.shortDays} totalSecs={summary.shortfallSecs} />)}
                        >
                            <div className="text-lg font-semibold tabular-nums">{formatHoursLong(summary.shortfallSecs)}</div>
                            <div className="text-[11px] text-secondary uppercase tracking-wide">Missing</div>
                        </div>
                        <div className="rounded-lg bg-(--bg-secondary) py-2">
                            <div className="text-lg font-semibold tabular-nums">
                                {summary.missingDays}
                                {!!summary.partialDays && <span className="text-sm text-amber-600"> +{summary.partialDays}</span>}
                            </div>
                            <div className="text-[11px] text-secondary uppercase tracking-wide">Empty / partial</div>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {WEEK_DAY_LABELS.map((label) => (
                            <div key={label} className="text-[10px] text-center text-secondary uppercase tracking-wide">
                                {label}
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-col gap-1">
                        {weeks.map((week, wi) => (
                            <div key={wi} className="grid grid-cols-7 gap-1">
                                {week.map((day, di) =>
                                    !day ? (
                                        <div key={`pad-${di}`} />
                                    ) : (
                                        <button
                                            key={day.key}
                                            type="button"
                                            onClick={() => addWorklog({ dateStarted: day.date })}
                                            title={`${formatDate(day.date, 'yyyy-MM-dd')}${day.offLabel ? ` (${day.offLabel})` : ''} — logged ${formatHoursLong(day.loggedSecs)}${day.expectedSecs ? ` of ${formatHoursLong(day.expectedSecs)}` : ''}`}
                                            className={`rounded-md py-1.5 px-1 text-center transition-colors hover:ring-2 hover:ring-blue-400 ${statusStyle[getStatus(day)]} ${day.isToday ? 'ring-2 ring-blue-500' : ''}`}
                                        >
                                            <div className="text-[10px] leading-none opacity-70">{day.dayOfMonth}</div>
                                            <div className="text-xs font-semibold tabular-nums leading-tight mt-0.5">
                                                {day.isOffDay && !day.loggedSecs ? '—' : formatHours(day.loggedSecs)}
                                            </div>
                                        </button>
                                    ),
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap text-[11px] text-secondary">
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-green-200 dark:bg-green-800 inline-block" /> target met
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-amber-200 dark:bg-amber-800 inline-block" /> partial
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-red-200 dark:bg-red-800 inline-block" /> nothing logged
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700 inline-block" /> non-working
                    </span>
                    <span className="ml-auto">Click any day to log time on it</span>
                </div>
            </div>
        </GadgetContainer>
    );
}
