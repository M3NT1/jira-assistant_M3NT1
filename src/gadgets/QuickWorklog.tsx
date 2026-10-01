import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWorklogStore } from '@/stores/worklog-store';

import { inject } from '@services';

import { Button, Checkbox, MaskedInput, TextInput } from '@components';

import { GadgetActionType } from '@constants';

import { DateTimePicker } from '../controls/DateTimePicker';
import { IssuePicker } from '../jira-controls/IssuePicker';

import { GadgetContainer, dashboardEventEmitter, useBaseGadget, type BaseGadgetProps } from './BaseGadget';
import { GadgetTitle } from './constants';

/** Recently logged tickets are remembered per gadget so the chips stay relevant */
const RECENT_LIMIT = 6;

export default function QuickWorklog(props: BaseGadgetProps) {
    const [ticketNo, setTicketNo] = useState<string | undefined>(undefined);
    const [timeSpent, setTimeSpent] = useState('');
    const [description, setDescription] = useState('');
    const [dateStarted, setDateStarted] = useState<Date>(() => new Date());
    const [isSaving, setIsSaving] = useState(false);
    const [bookmarks, setBookmarks] = useState<string[]>([]);
    const [recent, setRecent] = useState<string[]>([]);

    const gadgetHook = useBaseGadget(props, {
        title: GadgetTitle.QuickWorklog,
        hideExport: true,
    });

    const { settingsRef, saveSettings, performAction } = gadgetHook;

    const { $worklog, $message, $session, $bookmark } = inject(
        'WorklogService',
        'MessageService',
        'SessionService',
        'BookmarkService',
    );

    const { startTimer } = useWorklogStore();

    const uploadImmediately = settingsRef.current.uploadImmediately ?? $session.CurrentUser?.autoUpload ?? false;
    const defaultTimeSpent = ($session.CurrentUser?.defaultTimeSpent as string) || '';
    const minCommentLength = ($session.CurrentUser?.commentLength as number) || 0;

    const loadChips = useCallback(() => {
        $bookmark
            .getIssueKeys()
            .then((keys: string[]) => setBookmarks((keys || []).slice(0, RECENT_LIMIT)))
            .catch(() => setBookmarks([]));

        setRecent((settingsRef.current.recentTickets || []).slice(0, RECENT_LIMIT));
    }, [$bookmark, settingsRef]);

    useEffect(() => {
        loadChips();
    }, [loadChips]);

    const rememberTicket = useCallback(
        (key: string) => {
            const existing: string[] = settingsRef.current.recentTickets || [];
            const next = [key, ...existing.filter((k) => k !== key)].slice(0, RECENT_LIMIT);
            settingsRef.current.recentTickets = next;
            setRecent(next);
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    const reset = useCallback(() => {
        setTicketNo(undefined);
        setTimeSpent('');
        setDescription('');
        setDateStarted(new Date());
    }, []);

    const canSave = useMemo(() => {
        if (!ticketNo || !timeSpent || timeSpent.length < 4) {
            return false;
        }
        if (minCommentLength > 0 && description.trim().length < minCommentLength) {
            return false;
        }
        return true;
    }, [ticketNo, timeSpent, description, minCommentLength]);

    const save = useCallback(async () => {
        if (!canSave || isSaving) {
            return;
        }

        setIsSaving(true);

        try {
            await $worklog.saveWorklog(
                {
                    ticketNo: ticketNo!,
                    dateStarted,
                    description: description.trim(),
                    timeSpent,
                },
                uploadImmediately,
            );

            rememberTicket(ticketNo!);
            $message.success(`${timeSpent} logged on ${ticketNo}`);
            reset();
            performAction(GadgetActionType.WorklogModified);
        } catch (err: any) {
            if (typeof err === 'string') {
                $message.error(err);
            } else if (err?.message) {
                $message.error(err.message);
            }
        } finally {
            setIsSaving(false);
        }
    }, [
        canSave,
        isSaving,
        $worklog,
        ticketNo,
        dateStarted,
        description,
        timeSpent,
        uploadImmediately,
        rememberTicket,
        $message,
        reset,
        performAction,
    ]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && canSave) {
                e.preventDefault();
                save();
            }
        },
        [canSave, save],
    );

    const pickChip = useCallback(
        (key: string) => {
            setTicketNo(key);
            if (!timeSpent && defaultTimeSpent) {
                setTimeSpent(defaultTimeSpent);
            }
        },
        [timeSpent, defaultTimeSpent],
    );

    const toggleUpload = useCallback(
        (value: boolean) => {
            settingsRef.current.uploadImmediately = value;
            saveSettings();
        },
        [settingsRef, saveSettings],
    );

    useEffect(() => {
        const handler = (action: any) => {
            if (action?.type === GadgetActionType.TicketBookmarked) {
                loadChips();
            }
        };
        dashboardEventEmitter.on('change', handler);
        return () => {
            dashboardEventEmitter.removeListener('change', handler);
        };
    }, [loadChips]);

    const chips = useMemo(() => {
        const merged: Array<{ key: string; source: 'recent' | 'bookmark' }> = [];
        recent.forEach((k) => merged.push({ key: k, source: 'recent' }));
        bookmarks.forEach((k) => {
            if (!merged.some((m) => m.key === k)) {
                merged.push({ key: k, source: 'bookmark' });
            }
        });
        return merged.slice(0, 10);
    }, [recent, bookmarks]);

    return (
        <GadgetContainer {...props} gadgetHook={gadgetHook} refreshData={loadChips}>
            <div className="flex flex-col gap-3 p-3" onKeyDown={handleKeyDown}>
                <IssuePicker
                    value={ticketNo}
                    useDisplay={true}
                    returnObject={false}
                    className="w-full"
                    placeholder="Ticket number or start typing the summary"
                    onPick={(val) => setTicketNo(typeof val === 'string' ? val : val?.key)}
                />

                <div className="flex gap-2 flex-wrap items-start">
                    <div className="w-24">
                        <MaskedInput
                            mask="99:99"
                            value={timeSpent}
                            onChange={(e) => setTimeSpent(e.value)}
                            placeholder="01:00"
                            title="Time spent (HH:mm)"
                        />
                    </div>
                    <div className="flex-1 min-w-40">
                        <DateTimePicker value={dateStarted} showTime showDayNav onChange={setDateStarted} className="w-full" />
                    </div>
                </div>

                <TextInput
                    value={description}
                    onChange={(e) => setDescription(e.value)}
                    placeholder={
                        minCommentLength > 0 ? `Work description (min ${minCommentLength} chars)` : 'Work description (optional)'
                    }
                />

                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="primary"
                        leftIcon={<i className="fa fa-check" />}
                        onClick={save}
                        disabled={!canSave}
                        isLoading={isSaving}
                        size="sm"
                        label={uploadImmediately ? 'Log & upload' : 'Log'}
                    />
                    {ticketNo && (
                        <Button
                            layout="outlined"
                            variant="success"
                            leftIcon={<i className="fa fa-play" />}
                            onClick={() => startTimer(ticketNo)}
                            size="sm"
                            label="Start timer"
                            title={`Track time on ${ticketNo} instead of logging a fixed amount`}
                        />
                    )}
                    <Checkbox
                        checked={uploadImmediately}
                        onChange={(e) => toggleUpload(e.value)}
                        label="Upload to Jira"
                        size="sm"
                    />
                    <span className="text-[11px] text-secondary ml-auto">Enter saves</span>
                </div>

                {!!chips.length && (
                    <div>
                        <div className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5">Frequently used</div>
                        <div className="flex flex-wrap gap-1.5">
                            {chips.map((chip) => (
                                <button
                                    key={chip.key}
                                    type="button"
                                    onClick={() => pickChip(chip.key)}
                                    title={chip.source === 'bookmark' ? 'Bookmarked ticket' : 'Recently logged'}
                                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors hover:ring-2 hover:ring-blue-400 ${
                                        ticketNo === chip.key
                                            ? 'bg-blue-500 text-white border-blue-500'
                                            : 'bg-(--bg-secondary) border-(--border-color)'
                                    }`}
                                >
                                    {chip.source === 'bookmark' && <i className="fa fa-bookmark mr-1 opacity-60" />}
                                    {chip.key}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </GadgetContainer>
    );
}
