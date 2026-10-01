import { endOfDay, format, formatDistanceToNow, isAfter, isBefore, isSameDay, startOfDay } from 'date-fns';
import type { CalendarViewMode } from 'fluxo-ui';

import type { Meeting, Worklog, WorklogCalendarEntry } from '@types';

import type { CalendarEvent, CalendarInfoEvent } from './types';

const snapMinutes = 15;

export const viewModes: Array<{ value: CalendarViewMode; label: string }> = [
    { value: 'dayGridMonth', label: 'Month' },
    { value: 'timeGridWeek', label: 'Week' },
    { value: 'timeGridDay', label: 'Day' },
    { value: 'listMonth', label: 'Month List' },
    { value: 'listWeek', label: 'Week List' },
    { value: 'listDay', label: 'Day List' },
    { value: 'dayGridWeek', label: 'Grid Week' },
    { value: 'dayGridDay', label: 'Grid Day' },
];

export function resolveViewMode(mode: string | undefined): CalendarViewMode | undefined {
    if (!mode) return undefined;
    return mode;
}

export function isTimeGridView(viewMode: CalendarViewMode): boolean {
    return viewMode === 'timeGridWeek' || viewMode === 'timeGridDay';
}

export function isDayGridView(viewMode: CalendarViewMode): boolean {
    return viewMode === 'dayGridMonth' || viewMode === 'dayGridWeek' || viewMode === 'dayGridDay';
}

export function isListView(viewMode: CalendarViewMode): boolean {
    return viewMode === 'listMonth' || viewMode === 'listWeek' || viewMode === 'listDay';
}

export function getTimeSpentInSeconds(timeSpent: string): number {
    if (!timeSpent) return 0;
    const parts = timeSpent.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 3600 + minutes * 60;
}

export function formatTimeSpent(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function snapTimeToGrid(gridMinutes: number, date: Date): Date {
    const minutes = date.getMinutes();
    let diff = minutes % gridMinutes;

    if (diff === 0) return date;

    const movedUp = diff <= Math.floor(gridMinutes / 2);
    if (movedUp) {
        diff = -diff;
    } else {
        diff = gridMinutes - diff;
    }

    const newDate = new Date(date);
    newDate.setMinutes(newDate.getMinutes() + diff);
    return newDate;
}

interface TimeRange {
    start: Date;
    end: Date;
}

/**
 * A resized worklog: only the dragged edge moves, and it snaps to the grid.
 * Null when the edge was dragged onto or past the other one, which leaves no time to log.
 */
export function getResizedWorklogRange(start: Date, end: Date, edge: 'top' | 'bottom', gridMinutes: number): TimeRange | null {
    const range = edge === 'top' ? { start: snapTimeToGrid(gridMinutes, start), end } : { start, end: snapTimeToGrid(gridMinutes, end) };
    return range.end.getTime() > range.start.getTime() ? range : null;
}

/** The parts of the calendar's drag state needed to work out where a drag would land */
interface WorklogDrag {
    type: 'move' | 'resize';
    edge?: 'top' | 'bottom';
    offsetMinutes: number;
    dayOffset: number;
    originalStart: Date;
    originalEnd: Date;
}

/**
 * The range a worklog would be saved with if the drag in progress were dropped now.
 * Applies the same offsets the time grid reports on drop and the same rules the drop
 * handlers save with, so the preview never shows a time the save would round differently.
 */
export function getDragPreviewRange(drag: WorklogDrag, gridMinutes: number): TimeRange {
    const { type, edge = 'bottom', offsetMinutes, dayOffset, originalStart, originalEnd } = drag;
    const original = { start: originalStart, end: originalEnd };

    // The calendar ignores a drop that has not moved a full slot yet
    if (offsetMinutes === 0 && (type === 'resize' || dayOffset === 0)) {
        return original;
    }

    const offsetMs = offsetMinutes * 60000;

    if (type === 'move') {
        // Moving snaps the new start to the grid and keeps the duration
        const start = snapTimeToGrid(gridMinutes, new Date(originalStart.getTime() + offsetMs + dayOffset * 24 * 60 * 60 * 1000));
        return { start, end: new Date(start.getTime() + originalEnd.getTime() - originalStart.getTime()) };
    }

    const start = edge === 'top' ? new Date(originalStart.getTime() + offsetMs) : originalStart;
    const end = edge === 'bottom' ? new Date(originalEnd.getTime() + offsetMs) : originalEnd;
    return getResizedWorklogRange(start, end, edge, gridMinutes) || original;
}

export function getEventDuration(entry: CalendarEvent): string {
    const start = entry.start instanceof Date ? entry.start : new Date(entry.start);
    const end = entry.end instanceof Date ? entry.end : new Date(entry.end);
    if (start && end) {
        const diff = (end.getTime() - start.getTime()) / 1000;
        return formatTimeSpent(diff);
    }
    return '00:00';
}

export function createWorklogEvent(entry: WorklogCalendarEntry, settings: any): CalendarEvent {
    return {
        id: entry.id,
        title: entry.title,
        start: entry.start,
        end: entry.end,
        entryType: 1,
        data: {
            entryType: 1,
            sourceObject: entry.sourceObject,
            source: 'worklog',
        },
        color: settings.worklogColor || '#9a9cff',
        borderColor: settings.worklogColor || '#9a9cff',
        editable: entry.editable,
        resizable: entry.editable,
    };
}

export function createMeetingEvent(meeting: Meeting, settings: any): CalendarEvent {
    const start = meeting.start?.dateTime ? new Date(meeting.start.dateTime) : new Date();
    const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime) : new Date(start.getTime() + 3600000);

    return {
        id: meeting.id,
        title: meeting.subject || meeting.summary || 'Meeting',
        start,
        end,
        entryType: 2,
        data: {
            entryType: 2,
            sourceObject: meeting,
            source: meeting.source || 'outlook',
        },
        color: settings.eventColor || '#51b749',
        borderColor: settings.eventColor || '#51b749',
        editable: false,
        resizable: false,
    };
}

export function createInfoEvent(date: Date, worklogs: Worklog[], maxHours: number, minHours: number, settings: any): CalendarEvent {
    const timeSpent = worklogs.reduce((sum, wl) => sum + getTimeSpentInSeconds(wl.timeSpent || ''), 0);
    const maxSeconds = maxHours ? maxHours * 3600 : Number.MAX_VALUE;
    const minSeconds = minHours ? minHours * 3600 : 0;

    let diff = 0;
    if (timeSpent > maxSeconds) {
        diff = timeSpent - maxSeconds;
    } else if (timeSpent < minSeconds) {
        diff = timeSpent - minSeconds;
    }

    const dateKey = format(date, 'yyyy-MM-dd');
    const backgroundColor = getDiffColor(diff, settings);

    return {
        id: dateKey,
        title: `Logged: ${formatTimeSpent(timeSpent)}${diff ? ` (${diff > 0 ? '+' : ''}${formatTimeSpent(Math.abs(diff))})` : ''}`,
        start: startOfDay(date),
        end: endOfDay(date),
        allDay: true,
        editable: false,
        resizable: false,
        entryType: 3,
        data: {
            entryType: 3,
            logged: timeSpent,
            diff,
            sourceObject: {
                id: dateKey,
                key: dateKey,
                logged: timeSpent,
                diff,
            } as CalendarInfoEvent,
        },
        color: backgroundColor,
        borderColor: backgroundColor,
    };
}

export function getDiffColor(diff: number, settings: any): string {
    if (diff > 0) {
        return settings.infoColor_high || '#ff6b6b';
    } else if (diff < 0) {
        return settings.infoColor_less || '#ffd43b';
    }
    return settings.infoColor_valid || '#51cf66';
}

export function formatMeetingTime(dateTime: string | Date | undefined): string {
    if (!dateTime) return '';
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    return format(date, 'HH:mm');
}

export function formatMeetingDate(dateTime: string | Date | undefined): string {
    if (!dateTime) return '';
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    return format(date, 'MMM dd, yyyy');
}

export function getRemainingTime(startDateTime: string | Date | undefined): string {
    if (!startDateTime) return '';
    const date = typeof startDateTime === 'string' ? new Date(startDateTime) : startDateTime;
    const now = new Date();

    if (isBefore(now, date)) {
        const distance = formatDistanceToNow(date, { addSuffix: true });
        return `(in ${distance.replace(/^in /, '')})`;
    }

    if (isAfter(now, date)) {
        return '';
    }

    return '';
}

export function filterEvents(events: CalendarEvent[], showMeetings: boolean, showWorklogs: boolean, showInfo: boolean): CalendarEvent[] {
    if (!showMeetings && !showWorklogs && !showInfo) {
        return [];
    }

    const types: (1 | 2 | 3)[] = [];
    if (showWorklogs) types.push(1);
    if (showMeetings) types.push(2);
    if (showInfo) types.push(3);

    if (types.length === 3) {
        return events;
    }

    return events.filter((e) => types.includes(e.data.entryType));
}

export function groupWorklogsByDate(worklogs: WorklogCalendarEntry[]): Map<string, WorklogCalendarEntry[]> {
    const grouped = new Map<string, WorklogCalendarEntry[]>();

    worklogs.forEach((wl) => {
        const dateKey = format(new Date(wl.start), 'yyyy-MM-dd');
        if (!grouped.has(dateKey)) {
            grouped.set(dateKey, []);
        }
        grouped.get(dateKey)!.push(wl);
    });

    return grouped;
}

export function getWorklogsForDate(worklogs: Worklog[], date: Date): Worklog[] {
    return worklogs.filter((wl) => isSameDay(new Date(wl.dateStarted), date));
}

/** Parse a time string like "09:00" into hours as a number */
export function parseTimeToHours(time: string | undefined): number {
    if (!time) return 0;
    const [h, m] = time.split(':').map(Number);
    return h + (m || 0) / 60;
}

export function getEntryTimeFormat(timeFormat: string | undefined): string {
    return (timeFormat || 'HH:mm')
        .replace(/[.:]ss/, '')
        .trim();
}
