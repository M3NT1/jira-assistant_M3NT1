import { useCallback, useEffect, useMemo, useState } from 'react';

import { addDays, endOfMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';

import { inject } from '@services';

import { Button, hideTooltip, SelectButton, showTooltip } from '@components';

import { formatDate, getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import { Column, NoDataRow, ScrollableTable, TBody, THead } from '../components/shared/ScrollableTable';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';
import './MonthlyTrend.css';

type PeriodKey = 'month' | '6m' | '1y' | '2y';

const periodList = [
    { value: 'month', label: 'This month' },
    { value: '6m', label: '6 months' },
    { value: '1y', label: '1 year' },
    { value: '2y', label: '2 years' },
];

/** Cell size per period so a year still fits without scrolling on a normal gadget */
const cellSize: Record<Exclude<PeriodKey, 'month'>, number> = {
    '6m': 15,
    '1y': 12,
    // Not smaller than this: below ~10px a cell stops being a reliable pointer target,
    // and two years scrolls horizontally instead
    '2y': 10,
};

const WEEK_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DayCell {
    key: string;
    date: Date;
    hours: number;
    /** 0 = nothing logged, 1..4 = share of the daily target reached */
    level: 0 | 1 | 2 | 3 | 4;
    expectedHours: number;
    isOffDay: boolean;
    offLabel?: string;
    isFuture: boolean;
}

/**
 * Bucket a day against the daily target rather than against the busiest day of the
 * period: for worklogs "did I reach my hours" is the question, and a relative scale
 * would repaint every cell whenever one outlier day appears.
 */
function getLevel(hours: number, target: number): 0 | 1 | 2 | 3 | 4 {
    if (hours <= 0) {
        return 0;
    }
    const reference = target > 0 ? target : 8;
    const ratio = hours / reference;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 1) return 3;
    return 4;
}

function formatHours(hours: number): string {
    if (!hours) {
        return '0h';
    }
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
}

/** Monday-first row index so the grid reads like a calendar */
function rowIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
}

function getRange(period: PeriodKey): { fromDate: Date; toDate: Date } {
    const today = new Date();

    if (period === 'month') {
        return { fromDate: startOfMonth(today), toDate: endOfMonth(today) };
    }

    const months = period === '6m' ? 6 : period === '1y' ? 12 : 24;
    // Whole weeks so the heatmap columns are never half-empty at the edges
    const from = startOfWeek(subMonths(addDays(today, 1), months), { weekStartsOn: 1 });
    return { fromDate: from, toDate: today };
}

export default function MonthlyTrend(props: BaseGadgetProps) {
    const [days, setDays] = useState<DayCell[]>([]);
    const [showTable, setShowTable] = useState(false);
    /** Which stat card is being pointed at, so its days can be picked out of the calendar */
    const [highlight, setHighlight] = useState<'streak' | 'empty' | null>(null);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.MonthlyTrend,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings, addWorklog } = gadgetHook;

    const { $worklog, $session, $userutils } = inject('WorklogService', 'SessionService', 'UserUtilsService');

    const [period, setPeriod] = useState<PeriodKey>((settingsRef.current.period as PeriodKey) || '1y');

    const targetHours = ($session.CurrentUser?.minHours as number) || 8;

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const { fromDate, toDate } = getRange(period);
        const start = getStartOfDay(fromDate);
        const end = getEndOfDay(toDate);

        $worklog
            .getWorklogs({ fromDate: start, toDate: end })
            .then((worklogs: any[]) => {
                const hoursByDay = new Map<string, number>();

                worklogs.forEach((wl) => {
                    const started = wl.dateStarted instanceof Date ? wl.dateStarted : new Date(wl.dateStarted);
                    const key = formatDate(started, 'yyyy-MM-dd');
                    hoursByDay.set(key, (hoursByDay.get(key) || 0) + (wl.totalSecs || 0) / 3600);
                });

                const now = getStartOfDay(new Date()).getTime();
                const cells: DayCell[] = [];

                for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
                    const key = formatDate(date, 'yyyy-MM-dd');
                    const hours = hoursByDay.get(key) || 0;
                    const expectedHours = $userutils.getExpectedHours(date);
                    const nonWorking = $userutils.getNonWorkingDay(date);

                    cells.push({
                        key,
                        date: new Date(date),
                        hours,
                        level: getLevel(hours, expectedHours || targetHours),
                        expectedHours,
                        isOffDay: expectedHours === 0,
                        offLabel: nonWorking?.name || (nonWorking ? (nonWorking.type === 'leave' ? 'Leave' : 'Holiday') : undefined),
                        isFuture: getStartOfDay(date).getTime() > now,
                    });
                }

                setDays(cells);
            })
            .finally(() => setIsLoading(false));
    }, [$worklog, $userutils, period, targetHours, setIsLoading]);

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

    const periodSelected = useCallback(
        (value: PeriodKey) => {
            if (!value) return;
            settingsRef.current.period = value;
            setPeriod(value);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const stats = useMemo(() => {
        const past = days.filter((d) => !d.isFuture);
        const totalHours = past.reduce((sum, d) => sum + d.hours, 0);
        const loggedDays = past.filter((d) => d.hours > 0).length;
        const workingDays = past.filter((d) => !d.isOffDay).length;
        const emptyDays = past.filter((d) => !d.isOffDay && d.hours === 0);

        // Longest run of consecutive working days with time logged; off days neither
        // break the streak nor extend it. The days themselves are kept so the card can
        // point at them in the calendar.
        let streakKeys: string[] = [];
        let currentKeys: string[] = [];

        past.forEach((d) => {
            if (d.isOffDay) {
                return;
            }
            if (d.hours > 0) {
                currentKeys.push(d.key);
                if (currentKeys.length > streakKeys.length) {
                    streakKeys = [...currentKeys];
                }
            } else {
                currentKeys = [];
            }
        });

        return {
            totalHours,
            loggedDays,
            missedDays: emptyDays.length,
            avgPerWorkingDay: workingDays ? totalHours / workingDays : 0,
            longestStreak: streakKeys.length,
            streakKeys: new Set(streakKeys),
            emptyKeys: new Set(emptyDays.map((d) => d.key)),
        };
    }, [days]);

    const showCellTooltip = useCallback(
        (e: React.MouseEvent | React.FocusEvent, cell: DayCell) => {
            const parts = [`${$userutils.formatDate(cell.date)}: ${formatHours(cell.hours)}`];
            if (cell.offLabel) {
                parts.push(cell.offLabel);
            }
            showTooltip(e as any, { content: parts.join(' · '), placement: 'auto' });
        },
        [$userutils],
    );

    // Week columns for the heatmap views
    const weeks = useMemo(() => {
        if (period === 'month') {
            return [];
        }

        const columns: Array<Array<DayCell | null>> = [];
        let current: Array<DayCell | null> = [];

        days.forEach((cell) => {
            const row = rowIndex(cell.date);
            if (!current.length && row > 0) {
                for (let i = 0; i < row; i++) {
                    current.push(null);
                }
            }
            current.push(cell);
            if (row === 6) {
                columns.push(current);
                current = [];
            }
        });

        if (current.length) {
            while (current.length < 7) {
                current.push(null);
            }
            columns.push(current);
        }

        return columns;
    }, [days, period]);

    /** Month label per week column, rendered only where a new month starts */
    const monthLabels = useMemo(
        () =>
            weeks.map((week) => {
                const firstReal = week.find((c): c is DayCell => !!c);
                if (!firstReal) return '';
                const isNewMonth = firstReal.date.getDate() <= 7;
                return isNewMonth ? MONTH_LABELS[firstReal.date.getMonth()] : '';
            }),
        [weeks],
    );

    const size = period === 'month' ? 0 : cellSize[period];

    const loggedRows = useMemo(() => days.filter((d) => d.hours > 0).reverse(), [days]);

    const highlightedKeys = useMemo(() => {
        if (highlight === 'streak') return stats.streakKeys;
        if (highlight === 'empty') return stats.emptyKeys;
        return null;
    }, [highlight, stats]);

    /** Marks the cells the hovered card refers to and pushes the rest back */
    const cellStateClass = useCallback(
        (cell: DayCell) => {
            if (!highlightedKeys) {
                return '';
            }
            return highlightedKeys.has(cell.key) ? 'ja-heat-mark' : 'ja-heat-dim';
        },
        [highlightedKeys],
    );

    /** Pointer and keyboard both drive the highlight, so it is not mouse-only */
    const cardHighlightProps = useCallback(
        (kind: 'streak' | 'empty', enabled: boolean) =>
            enabled
                ? {
                    tabIndex: 0,
                    onMouseEnter: () => setHighlight(kind),
                    onMouseLeave: () => setHighlight(null),
                    onFocus: () => setHighlight(kind),
                    onBlur: () => setHighlight(null),
                }
                : {},
        [],
    );

    const customActions = useMemo(
        () => (
            <div className="flex items-center gap-1.5">
                <SelectButton
                    items={periodList}
                    value={period}
                    onChange={(e: any) => periodSelected(e.value as PeriodKey)}
                    variant="segmented"
                    size="sm"
                />
                <Button
                    layout={showTable ? 'default' : 'plain'}
                    variant="secondary"
                    size="sm"
                    leftIcon={<i className="fa fa-table" />}
                    onClick={() => setShowTable((v) => !v)}
                    title={showTable ? 'Show the calendar' : 'Show the values as a table'}
                />
            </div>
        ),
        [period, periodSelected, showTable],
    );

    const hint = (
        <div className="max-w-xs text-xs">
            Hours logged per day. Colour shows how much of your daily target ({formatHours(targetHours)}) the day reached, so a full day is
            always the darkest step regardless of the period. Weekends, holidays and leave are dimmed. Use the table button for the exact
            values.
        </div>
    );

    const legend = (
        <div className="flex items-center gap-2 text-[11px] text-secondary">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={`ja-heat-cell ja-heat-level-${level} inline-block`} style={{ width: 11, height: 11 }} />
            ))}
            <span>More</span>
            <span className="ml-1 hidden sm:inline">
                (0 &middot; &lt;{Math.round(targetHours * 0.25)}h &middot; &lt;{Math.round(targetHours * 0.5)}h &middot; &lt;
                {targetHours}h &middot; {targetHours}h+)
            </span>
        </div>
    );

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            customActions={customActions}
            hint={hint}
            subTitle={days.length ? `${formatHours(stats.totalHours)} logged` : undefined}
        >
            <div className="ja-heatmap flex flex-col gap-3 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg bg-(--bg-secondary) py-2">
                        <div className="text-lg font-semibold">{formatHours(stats.totalHours)}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Total</div>
                    </div>
                    <div className="rounded-lg bg-(--bg-secondary) py-2">
                        <div className="text-lg font-semibold">{formatHours(stats.avgPerWorkingDay)}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Avg / work day</div>
                    </div>
                    <div
                        className={`rounded-lg bg-(--bg-secondary) py-2 ${stats.longestStreak && !showTable ? 'ja-heat-card' : ''} ${highlight === 'streak' ? 'ja-heat-card-active' : ''}`}
                        title={stats.longestStreak && !showTable ? 'Point at this to find the streak in the calendar' : undefined}
                        {...cardHighlightProps('streak', !!stats.longestStreak && !showTable)}
                    >
                        <div className="text-lg font-semibold">{stats.longestStreak}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Longest streak</div>
                    </div>
                    <div
                        className={`rounded-lg py-2 ${stats.missedDays ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-(--bg-secondary)'} ${stats.missedDays && !showTable ? 'ja-heat-card' : ''} ${highlight === 'empty' ? 'ja-heat-card-active' : ''}`}
                        title={
                            stats.missedDays && !showTable
                                ? 'Working days with nothing logged — point at this to find them'
                                : 'Working days with nothing logged'
                        }
                        {...cardHighlightProps('empty', !!stats.missedDays && !showTable)}
                    >
                        <div className="text-lg font-semibold">{stats.missedDays}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">Empty work days</div>
                    </div>
                </div>

                {showTable ? (
                    <ScrollableTable dataset={loggedRows} exportSheetName="Logged hours per day">
                        <THead>
                            <tr>
                                <Column sortBy="key">Date</Column>
                                <Column sortBy="hours">Logged</Column>
                                <Column sortBy="expectedHours">Target</Column>
                            </tr>
                        </THead>
                        <TBody>
                            {(row: DayCell) => (
                                <tr key={row.key}>
                                    <td className="whitespace-nowrap">{$userutils.formatDate(row.date)}</td>
                                    <td className="tabular-nums">{formatHours(row.hours)}</td>
                                    <td className="tabular-nums">{row.expectedHours ? formatHours(row.expectedHours) : '—'}</td>
                                </tr>
                            )}
                        </TBody>
                        <NoDataRow span={3}>No time logged in this period.</NoDataRow>
                    </ScrollableTable>
                ) : period === 'month' ? (
                    <div>
                        <div className="grid grid-cols-7 gap-1 mb-1">
                            {WEEK_DAY_LABELS.map((label) => (
                                <div key={label} className="text-[10px] text-center text-secondary uppercase tracking-wide">
                                    {label}
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                            {/* Pad so the 1st lands on its weekday */}
                            {days.length > 0 &&
                                Array.from({ length: rowIndex(days[0].date) }).map((_, i) => <div key={`pad-${i}`} />)}
                            {days.map((cell) => (
                                <button
                                    key={cell.key}
                                    type="button"
                                    onClick={() => addWorklog({ dateStarted: cell.date })}
                                    onMouseEnter={(e) => showCellTooltip(e, cell)}
                                    onMouseLeave={() => hideTooltip()}
                                    onFocus={(e) => showCellTooltip(e, cell)}
                                    onBlur={() => hideTooltip()}
                                    className={`ja-heat-cell ja-heat-month-cell ja-heat-level-${cell.level} ${cell.isOffDay ? 'ja-heat-off' : ''} ${cellStateClass(cell)} flex flex-col items-center justify-center`}
                                    aria-label={`${cell.key}: ${formatHours(cell.hours)}`}
                                >
                                    <span className="text-[10px] leading-none opacity-70">{cell.date.getDate()}</span>
                                    <span className="text-xs font-semibold leading-tight mt-0.5">
                                        {cell.hours ? formatHours(cell.hours) : cell.isOffDay ? '' : '·'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="ja-heat-scroll">
                        <div className="flex gap-1" style={{ minWidth: 'max-content' }}>
                            <div className="flex flex-col gap-1 pr-1 shrink-0" style={{ paddingTop: 14 }}>
                                {WEEK_DAY_LABELS.map((label, i) => (
                                    <div
                                        key={label}
                                        className="text-[9px] text-secondary leading-none flex items-center"
                                        style={{ height: size }}
                                    >
                                        {/* Every other label only: at 9px cells all seven would collide */}
                                        {i % 2 === 0 ? label : ''}
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-1">
                                {weeks.map((week, wi) => (
                                    <div key={wi} className="flex flex-col gap-1">
                                        <div
                                            className="text-[9px] text-secondary leading-none whitespace-nowrap"
                                            style={{ height: 14 }}
                                        >
                                            {monthLabels[wi]}
                                        </div>
                                        {week.map((cell, di) =>
                                            !cell ? (
                                                <div key={`empty-${di}`} style={{ width: size, height: size }} />
                                            ) : cell.isFuture ? (
                                                <div key={cell.key} style={{ width: size, height: size }} />
                                            ) : (
                                                <button
                                                    key={cell.key}
                                                    type="button"
                                                    onClick={() => addWorklog({ dateStarted: cell.date })}
                                                    onMouseEnter={(e) => showCellTooltip(e, cell)}
                                                    onMouseLeave={() => hideTooltip()}
                                                    onFocus={(e) => showCellTooltip(e, cell)}
                                                    onBlur={() => hideTooltip()}
                                                    className={`ja-heat-cell ja-heat-level-${cell.level} ${cell.isOffDay ? 'ja-heat-off' : ''} ${cellStateClass(cell)}`}
                                                    style={{ width: size, height: size }}
                                                    aria-label={`${cell.key}: ${formatHours(cell.hours)}`}
                                                />
                                            ),
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {!showTable && (
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        {legend}
                        <span className="text-[11px] text-secondary">Click a day to log time on it</span>
                    </div>
                )}
            </div>
        </GadgetContainer>
    );
}
