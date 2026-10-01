import { useCallback, useEffect, useMemo, useState } from 'react';

import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Title, Tooltip } from 'chart.js';
import { addDays, startOfWeek } from 'date-fns';
import { Bar } from 'react-chartjs-2';

import { inject } from '@services';

import { formatDate, getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

/** How many past weeks feed the comparison average */
const HISTORY_WEEKS = 4;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface TrendState {
    thisWeek: number[];
    lastWeek: number[];
    average: number[];
    expected: number[];
    thisWeekTotal: number;
    lastWeekTotal: number;
    averageTotal: number;
    expectedTotal: number;
}

const emptyState: TrendState = {
    thisWeek: [],
    lastWeek: [],
    average: [],
    expected: [],
    thisWeekTotal: 0,
    lastWeekTotal: 0,
    averageTotal: 0,
    expectedTotal: 0,
};

/** Monday-first index so the chart columns line up with DAY_LABELS */
function dayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
}

function formatHours(hours: number): string {
    if (!hours) return '0h';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
}

export default function WeeklyTrend(props: BaseGadgetProps) {
    const [state, setState] = useState<TrendState>(emptyState);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.WeeklyTrend,
        hideExport: false,
    });

    const { setIsLoading } = gadgetHook;

    const { $worklog, $session, $userutils } = inject('WorklogService', 'SessionService', 'UserUtilsService');

    const weekStartsOn = useMemo(() => {
        const startOfWeekSetting = $session.CurrentUser?.startOfWeek;
        // 0 means "use locale default"; the app stores 1-7 where 1 = Sunday
        if (!startOfWeekSetting) {
            return 1 as const;
        }
        return ((startOfWeekSetting - 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    }, [$session]);

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const thisWeekStart = startOfWeek(new Date(), { weekStartsOn });
        const historyStart = addDays(thisWeekStart, -7 * HISTORY_WEEKS);
        const thisWeekEnd = addDays(thisWeekStart, 6);

        $worklog
            .getWorklogs({ fromDate: getStartOfDay(historyStart), toDate: getEndOfDay(thisWeekEnd) })
            .then((worklogs: any[]) => {
                const hoursByDay = new Map<string, number>();

                worklogs.forEach((wl) => {
                    const started = wl.dateStarted instanceof Date ? wl.dateStarted : new Date(wl.dateStarted);
                    const key = formatDate(started, 'yyyy-MM-dd');
                    hoursByDay.set(key, (hoursByDay.get(key) || 0) + (wl.totalSecs || 0) / 3600);
                });

                const readWeek = (weekStart: Date): number[] => {
                    const values = new Array(7).fill(0);
                    for (let i = 0; i < 7; i++) {
                        const date = addDays(weekStart, i);
                        values[dayIndex(date)] = hoursByDay.get(formatDate(date, 'yyyy-MM-dd')) || 0;
                    }
                    return values;
                };

                const thisWeek = readWeek(thisWeekStart);
                const lastWeek = readWeek(addDays(thisWeekStart, -7));

                // Average across the preceding weeks, excluding the current partial one
                const historyWeeks: number[][] = [];
                for (let w = 1; w <= HISTORY_WEEKS; w++) {
                    historyWeeks.push(readWeek(addDays(thisWeekStart, -7 * w)));
                }
                const average = new Array(7)
                    .fill(0)
                    .map((_, i) => historyWeeks.reduce((sum, week) => sum + week[i], 0) / historyWeeks.length);

                const expected = new Array(7).fill(0).map((_, i) => {
                    // Map the Monday-first column back to a real date in the current week
                    for (let d = 0; d < 7; d++) {
                        const date = addDays(thisWeekStart, d);
                        if (dayIndex(date) === i) {
                            return $userutils.getExpectedHours(date);
                        }
                    }
                    return 0;
                });

                const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

                setState({
                    thisWeek,
                    lastWeek,
                    average,
                    expected,
                    thisWeekTotal: sum(thisWeek),
                    lastWeekTotal: sum(lastWeek),
                    averageTotal: sum(average),
                    expectedTotal: sum(expected),
                });
            })
            .finally(() => setIsLoading(false));
    }, [$worklog, $userutils, weekStartsOn, setIsLoading]);

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

    const chartData = useMemo(
        () => ({
            labels: DAY_LABELS,
            datasets: [
                {
                    type: 'bar' as const,
                    label: 'This week',
                    data: state.thisWeek,
                    backgroundColor: 'rgba(59,130,246,0.8)',
                    borderColor: 'rgb(59,130,246)',
                    borderWidth: 1,
                    borderRadius: 3,
                    order: 3,
                },
                {
                    type: 'bar' as const,
                    label: 'Last week',
                    data: state.lastWeek,
                    backgroundColor: 'rgba(148,163,184,0.55)',
                    borderColor: 'rgb(148,163,184)',
                    borderWidth: 1,
                    borderRadius: 3,
                    order: 4,
                },
                {
                    type: 'line' as const,
                    label: `${HISTORY_WEEKS}-week average`,
                    data: state.average,
                    borderColor: 'rgb(168,85,247)',
                    backgroundColor: 'rgb(168,85,247)',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.3,
                    order: 1,
                },
                {
                    type: 'line' as const,
                    label: 'Expected',
                    data: state.expected,
                    borderColor: 'rgb(34,197,94)',
                    backgroundColor: 'rgb(34,197,94)',
                    borderWidth: 1,
                    borderDash: [5, 4],
                    pointRadius: 0,
                    order: 2,
                },
            ],
        }),
        [state],
    );

    const chartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { mode: 'index' as const, intersect: false },
            plugins: {
                legend: {
                    position: 'bottom' as const,
                    labels: { color: '#6c757d', boxWidth: 14, padding: 12, font: { size: 11 } },
                },
                tooltip: {
                    callbacks: {
                        label: (item: any) => `${item.dataset.label}: ${formatHours(item.parsed.y || 0)}`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#6c757d', font: { size: 11 } },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#6c757d', font: { size: 11 } },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    title: { display: true, text: 'Hours', color: '#6c757d', font: { size: 11 } },
                },
            },
        }),
        [],
    );

    const deltaVsLast = state.thisWeekTotal - state.lastWeekTotal;
    const deltaVsAvg = state.thisWeekTotal - state.averageTotal;

    const renderDelta = (delta: number, label: string) => {
        const isUp = delta > 0.05;
        const isDown = delta < -0.05;
        const colour = isUp ? 'text-green-600 dark:text-green-400' : isDown ? 'text-red-600 dark:text-red-400' : 'text-secondary';
        const icon = isUp ? 'fa-arrow-up' : isDown ? 'fa-arrow-down' : 'fa-minus';
        return (
            <div className="rounded-lg bg-(--bg-secondary) py-2 text-center">
                <div className={`text-lg font-semibold tabular-nums ${colour}`}>
                    <i className={`fa ${icon} text-xs mr-1`} />
                    {formatHours(Math.abs(delta))}
                </div>
                <div className="text-[11px] text-secondary uppercase tracking-wide">{label}</div>
            </div>
        );
    };

    return (
        <GadgetContainer
            {...props}
            gadgetHook={gadgetHook}
            refreshData={refreshData}
            subTitle={`${formatHours(state.thisWeekTotal)} of ${formatHours(state.expectedTotal)}`}
        >
            <div className="flex flex-col gap-3 p-3">
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-(--bg-secondary) py-2 text-center">
                        <div className="text-lg font-semibold tabular-nums">{formatHours(state.thisWeekTotal)}</div>
                        <div className="text-[11px] text-secondary uppercase tracking-wide">This week</div>
                    </div>
                    {renderDelta(deltaVsLast, 'vs last week')}
                    {renderDelta(deltaVsAvg, `vs ${HISTORY_WEEKS}w avg`)}
                </div>

                <div style={{ height: 240 }}>
                    <Bar data={chartData as any} options={chartOptions as any} />
                </div>
            </div>
        </GadgetContainer>
    );
}
