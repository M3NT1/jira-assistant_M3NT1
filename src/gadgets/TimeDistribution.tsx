import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { startOfMonth } from 'date-fns';
import { Doughnut } from 'react-chartjs-2';

import { inject } from '@services';

import { Dropdown } from '@components';

import { distinct, getEndOfDay, getStartOfDay } from '@utils';

import { GadgetActionType } from '@constants';

import DateRangePicker from '../controls/DateRangePicker';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

ChartJS.register(ArcElement, Tooltip, Legend);

type GroupMode = 'project' | 'issuetype' | 'status' | 'priority' | 'parent';

const groupOptions: Array<{ value: GroupMode; label: string }> = [
    { value: 'project', label: 'Project' },
    { value: 'parent', label: 'Epic / Parent' },
    { value: 'issuetype', label: 'Issue type' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
];

const PALETTE = [
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#f59e0b',
    '#10b981',
    '#06b6d4',
    '#ef4444',
    '#6366f1',
    '#84cc16',
    '#f97316',
    '#14b8a6',
    '#a855f7',
];

interface Slice {
    label: string;
    secs: number;
    colour: string;
}

function formatHours(secs: number): string {
    const hours = secs / 3600;
    if (hours < 1) {
        return `${Math.round(secs / 60)}m`;
    }
    return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

export default function TimeDistribution(props: BaseGadgetProps) {
    const [slices, setSlices] = useState<Slice[]>([]);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.TimeDistribution,
        hideExport: false,
    });

    const { setIsLoading, settingsRef, saveSettings } = gadgetHook;

    const { $worklog, $ticket, $jira } = inject('WorklogService', 'TicketService', 'JiraService');

    const initialRange = useMemo(() => {
        const stored = settingsRef.current.dateRange;
        if (stored?.fromDate && stored?.toDate) {
            return { fromDate: new Date(stored.fromDate), toDate: new Date(stored.toDate), quickDate: stored.quickDate };
        }
        const now = new Date();
        return { fromDate: startOfMonth(now), toDate: now, quickDate: undefined as string | number | undefined };
    }, [settingsRef]);

    const [range, setRange] = useState(initialRange);
    const [groupMode, setGroupMode] = useState<GroupMode>((settingsRef.current.groupMode as GroupMode) || 'project');

    const refreshData = useCallback(() => {
        setIsLoading(true);

        const fromDate = getStartOfDay(range.fromDate);
        const toDate = getEndOfDay(range.toDate);

        (async () => {
            try {
                const worklogs: any[] = await $worklog.getWorklogs({ fromDate, toDate });

                if (!worklogs.length) {
                    setSlices([]);
                    return;
                }

                const ticketNos = distinct(worklogs, (w: any) => w.ticketNo);

                // "Epic Link" is a Greenhopper custom field on Server / DC, so its id has to be
                // discovered by name rather than assumed
                let epicLinkFieldId: string | undefined;
                if (groupMode === 'parent') {
                    try {
                        const fields = await $jira.getCustomFields();
                        epicLinkFieldId = fields.find((f: any) => f.name === 'Epic Link' || f.name === 'Parent Link')?.id;
                    } catch (err) {
                        console.warn('Unable to resolve the Epic Link field', err);
                    }
                }

                const wantedFields = ['project', 'issuetype', 'status', 'priority', 'summary', 'parent'];
                if (epicLinkFieldId) {
                    wantedFields.push(epicLinkFieldId);
                }

                const details = await $ticket.getTicketDetails(ticketNos, false, wantedFields, {
                    allowCache: true,
                    ignoreErrors: true,
                });

                const secsByGroup = new Map<string, number>();

                worklogs.forEach((wl) => {
                    const fields = details?.[wl.ticketNo]?.fields || {};
                    let label: string;

                    switch (groupMode) {
                        case 'project':
                            label = fields.project?.name || fields.project?.key || wl.ticketNo.split('-')[0] || 'Unknown';
                            break;
                        case 'issuetype':
                            label = fields.issuetype?.name || 'Unknown';
                            break;
                        case 'status':
                            label = fields.status?.name || 'Unknown';
                            break;
                        case 'priority':
                            label = fields.priority?.name || 'None';
                            break;
                        case 'parent': {
                            const epicKey = epicLinkFieldId ? fields[epicLinkFieldId] : undefined;
                            label =
                                (typeof epicKey === 'string' ? epicKey : epicKey?.key) ||
                                fields.parent?.key ||
                                '(no epic / parent)';
                            break;
                        }
                        default:
                            label = 'Unknown';
                    }

                    secsByGroup.set(label, (secsByGroup.get(label) || 0) + (wl.totalSecs || 0));
                });

                const sorted = [...secsByGroup.entries()].sort((a, b) => b[1] - a[1]);

                // Keep the chart readable: everything past the palette becomes one "Other" slice
                const head = sorted.slice(0, PALETTE.length - 1);
                const tail = sorted.slice(PALETTE.length - 1);

                const result: Slice[] = head.map(([label, secs], i) => ({ label, secs, colour: PALETTE[i] }));

                if (tail.length) {
                    result.push({
                        label: `Other (${tail.length})`,
                        secs: tail.reduce((sum, [, secs]) => sum + secs, 0),
                        colour: PALETTE[PALETTE.length - 1],
                    });
                }

                setSlices(result);
            } catch (err) {
                console.error('Unable to build time distribution', err);
                setSlices([]);
            } finally {
                setIsLoading(false);
            }
        })();
    }, [$worklog, $ticket, $jira, range, groupMode, setIsLoading]);

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

    const groupChanged = useCallback(
        (mode: GroupMode) => {
            settingsRef.current.groupMode = mode;
            setGroupMode(mode);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const totalSecs = useMemo(() => slices.reduce((sum, s) => sum + s.secs, 0), [slices]);

    const chartData = useMemo(
        () => ({
            labels: slices.map((s) => s.label),
            datasets: [
                {
                    data: slices.map((s) => parseFloat((s.secs / 3600).toFixed(2))),
                    backgroundColor: slices.map((s) => s.colour),
                    borderWidth: 0,
                    hoverOffset: 6,
                },
            ],
        }),
        [slices],
    );

    const chartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (item: any) => {
                            const secs = slices[item.dataIndex]?.secs || 0;
                            const perc = totalSecs ? Math.round((secs / totalSecs) * 100) : 0;
                            return `${item.label}: ${formatHours(secs)} (${perc}%)`;
                        },
                    },
                },
            },
        }),
        [slices, totalSecs],
    );

    const customActions = useMemo(
        () => (
            <div className="flex items-center gap-1.5">
                <Dropdown
                    className="w-36"
                    options={groupOptions}
                    value={groupMode}
                    onChange={(e) => groupChanged(e.value as GroupMode)}
                />
                <DateRangePicker value={[range.fromDate, range.toDate]} onChange={dateSelected} classNames={{ container: 'w-48' }} />
            </div>
        ),
        [groupMode, groupChanged, range, dateSelected],
    );

    if (!slices.length) {
        return (
            <GadgetContainer {...props} gadgetHook={gadgetHook} refreshData={refreshData} customActions={customActions}>
                <div className="flex items-center justify-center py-10 px-4">
                    <div className="text-center text-secondary">
                        <i className="fa fa-pie-chart text-4xl mb-3 opacity-30 block" />
                        <p className="text-base font-medium">No worklogs in this period</p>
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
            customActions={customActions}
            subTitle={formatHours(totalSecs)}
        >
            <div className="flex flex-wrap gap-4 p-3">
                <div className="relative shrink-0" style={{ width: 190, height: 190 }}>
                    <Doughnut data={chartData} options={chartOptions as any} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-xl font-semibold tabular-nums">{formatHours(totalSecs)}</span>
                        <span className="text-[10px] text-secondary uppercase tracking-wide">total</span>
                    </div>
                </div>

                <div className="flex-1 min-w-48 flex flex-col gap-1 max-h-52 overflow-auto">
                    {slices.map((s) => {
                        const perc = totalSecs ? Math.round((s.secs / totalSecs) * 100) : 0;
                        return (
                            <div key={s.label} className="flex items-center gap-2 text-sm">
                                <span className="w-3 h-3 rounded shrink-0" style={{ backgroundColor: s.colour }} />
                                <span className="truncate flex-1" title={s.label}>
                                    {s.label}
                                </span>
                                <span className="tabular-nums text-xs font-medium shrink-0">{formatHours(s.secs)}</span>
                                <span className="tabular-nums text-xs text-secondary shrink-0 w-9 text-right">{perc}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </GadgetContainer>
    );
}
