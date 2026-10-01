import { useCallback, useEffect, useState } from 'react';

import { useWorklogStore } from '@/stores/worklog-store';

import { inject } from '@services';

import { Button } from '@components';

import { Image } from '../controls';
import Link from '../controls/Link';
import AddWorklog from '../dialogs/AddWorklog';

import { GadgetContainer, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

function padNum(n: number, len: number): string {
    return String(n).padStart(len, '0');
}

function formatLapse(lapse: number): string {
    const hours = Math.floor(lapse / 3600);
    const mins = Math.floor((lapse % 3600) / 60);
    const secs = Math.floor(lapse % 60);
    return `${padNum(hours, 2)}:${padNum(mins, 2)}:${padNum(secs, 2)}`;
}

/** Ticks once a second while the timer runs so the elapsed display stays live */
function useLiveLapse(lapse: number, isRunning: boolean): number {
    const [value, setValue] = useState(lapse);

    useEffect(() => {
        setValue(lapse);
    }, [lapse]);

    useEffect(() => {
        if (!isRunning) {
            return;
        }
        const token = setInterval(() => setValue((v) => v + 1), 1000);
        return () => clearInterval(token);
    }, [isRunning]);

    return value;
}

export default function WorklogTimerGadget(props: BaseGadgetProps) {
    const [showEditor, setShowEditor] = useState(false);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.WorklogTimer,
        hideExport: true,
    });

    const { setIsLoading } = gadgetHook;

    const { $userutils } = inject('UserUtilsService');
    const { curState, ticketsList, loadTracker, loadTicketList, startTimer, pauseTimer, resumeTimer, stopTimer } = useWorklogStore();

    const hasTimer = !!curState?.key;
    const lapse = useLiveLapse(curState?.lapse || 0, !!curState?.isRunning);

    const refreshData = useCallback(() => {
        setIsLoading(true);
        Promise.all([loadTracker(), loadTicketList()]).finally(() => setIsLoading(false));
    }, [loadTracker, loadTicketList, setIsLoading]);

    useEffect(() => {
        refreshData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const ticketUrl = hasTimer ? $userutils.getTicketUrl(curState.key) || '' : '';

    return (
        <GadgetContainer {...props} gadgetHook={gadgetHook} refreshData={refreshData}>
            <div className="flex flex-col gap-4 p-3">
                {hasTimer ? (
                    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <Link className="font-semibold text-blue-700 dark:text-blue-300" href={ticketUrl}>
                                    {curState.key}
                                </Link>
                                <div className="text-xs text-secondary truncate mt-0.5">
                                    {curState.description || 'No working comment set'}
                                </div>
                            </div>
                            <div className="font-mono text-2xl font-semibold tabular-nums">{formatLapse(lapse)}</div>
                        </div>

                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {curState.isRunning ? (
                                <Button
                                    variant="warning"
                                    leftIcon={<i className="fa fa-pause" />}
                                    onClick={pauseTimer}
                                    size="sm"
                                    label="Pause"
                                />
                            ) : (
                                <Button
                                    variant="success"
                                    leftIcon={<i className="fa fa-play" />}
                                    onClick={resumeTimer}
                                    size="sm"
                                    label="Resume"
                                />
                            )}
                            <Button
                                variant="danger"
                                leftIcon={<i className="fa fa-stop" />}
                                onClick={stopTimer}
                                size="sm"
                                label="Stop & log"
                                title="Stop tracking and create a worklog entry"
                            />
                            <Button
                                layout="outlined"
                                leftIcon={<i className="fa fa-edit" />}
                                onClick={() => setShowEditor(true)}
                                size="sm"
                                label="Comment"
                                title="Edit the working comment"
                            />
                        </div>
                        {curState.hasError && (
                            <div className="text-xs text-red-600 dark:text-red-400 mt-2">
                                System time changed since the timer started. Stop and restart the timer.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-(--border-color) p-4 text-center text-sm text-secondary">
                        No timer is running. Pick a ticket below to start tracking.
                    </div>
                )}

                <div>
                    <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Start tracking on</div>
                    {ticketsList?.length ? (
                        <div className="flex flex-col gap-1 max-h-60 overflow-auto">
                            {ticketsList.map((t) => (
                                <div
                                    key={t.key}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-(--bg-hover) transition-colors"
                                >
                                    {t.issuetype?.iconUrl && <Image src={t.issuetype.iconUrl} />}
                                    <Link className="font-medium shrink-0" href={t.url || ''}>
                                        {t.key}
                                    </Link>
                                    <span className="text-xs text-secondary truncate flex-1" title={t.summary}>
                                        {t.summary}
                                    </span>
                                    <Button
                                        layout="plain"
                                        variant="success"
                                        leftIcon={<i className="fa fa-play" />}
                                        onClick={() => startTimer(t.key)}
                                        title={`Start timer for ${t.key}`}
                                        size="sm"
                                        disabled={curState?.key === t.key}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-secondary italic">
                            No recently viewed or assigned tickets found. Open a ticket in Jira to see it here.
                        </div>
                    )}
                </div>
            </div>

            {showEditor && (
                <AddWorklog
                    editTracker={true}
                    onDone={() => {
                        setShowEditor(false);
                        loadTracker();
                    }}
                    onHide={() => setShowEditor(false)}
                />
            )}
        </GadgetContainer>
    );
}
