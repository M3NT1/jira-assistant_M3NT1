import React from 'react';

import { addDays, format, parse } from 'date-fns';

interface DateTimePickerProps {
    value?: Date | string;
    onChange?: (date: Date) => void;
    showTime?: boolean;
    className?: string;
    disabled?: boolean;
    placeholder?: string;
    /** Show previous / next day arrow buttons around the input (issue #393) */
    showDayNav?: boolean;
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
    value,
    onChange,
    showTime = false,
    className = '',
    disabled = false,
    placeholder = 'Select date',
    showDayNav = false,
}) => {
    const formatString = showTime ? 'yyyy-MM-dd\'T\'HH:mm' : 'yyyy-MM-dd';

    const getDateValue = (): Date | null => {
        if (!value) return null;

        try {
            const dateObj = value instanceof Date ? value : new Date(value);
            return isNaN(dateObj.getTime()) ? null : dateObj;
        } catch {
            return null;
        }
    };

    const getFormattedValue = (): string => {
        const dateObj = getDateValue();
        return dateObj ? format(dateObj, formatString) : '';
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (!newValue) {
            onChange?.(new Date());
            return;
        }

        try {
            const parsedDate = parse(newValue, formatString, new Date());
            if (!isNaN(parsedDate.getTime())) {
                onChange?.(parsedDate);
            }
        } catch (error) {
            console.error('Error parsing date:', error);
        }
    };

    const shiftDay = (days: number) => {
        const dateObj = getDateValue() || new Date();
        onChange?.(addDays(dateObj, days));
    };

    const input = (
        <input
            type={showTime ? 'datetime-local' : 'date'}
            value={getFormattedValue()}
            onChange={handleChange}
            disabled={disabled}
            placeholder={placeholder}
            className={`px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 ${showDayNav ? 'flex-1 min-w-0' : className}`}
        />
    );

    if (!showDayNav) {
        return input;
    }

    const navButtonClass =
        'px-2 py-2 border border-gray-300 rounded-md text-gray-500 hover:text-blue-600 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300';

    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <button type="button" className={navButtonClass} title="Previous day" disabled={disabled} onClick={() => shiftDay(-1)}>
                <i className="fa fa-chevron-left" />
            </button>
            {input}
            <button type="button" className={navButtonClass} title="Next day" disabled={disabled} onClick={() => shiftDay(1)}>
                <i className="fa fa-chevron-right" />
            </button>
        </div>
    );
};

export default DateTimePicker;
