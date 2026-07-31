import { GadgetTitle } from '@/gadgets/constants';

import {
    BaseGadgetUnavailable,
    CalendarGadget,
    DateWiseWorklog,
    MyBookmarks,
    MyOpenTickets,
    MyReports,
    PendingWorklog,
    StatusWiseTimeSpent,
    TicketWiseWorklog,
    WorklogBarChartGadget,
    WorklogReport,
} from '../../gadgets';

interface GadgetComponentInfo {
    Component: React.ComponentType<any>;
    props?: Record<string, any>;
}

/**
 * Report viewers are not migrated yet, so a saved report placed on a dashboard cannot be
 * rendered. Say so plainly instead of calling it an unknown gadget.
 */
function unavailableReport(kind: string, name?: string): GadgetComponentInfo {
    return {
        Component: BaseGadgetUnavailable,
        props: {
            title: name || kind,
            message: `${kind} gadgets are not available in this version yet. Open the report from the Reports menu to view its data.`,
        },
    };
}

export function getGadgetComponent(gadgetName: string, opts: string[] = []): GadgetComponentInfo | null {
    const gadgetMap: Record<string, () => GadgetComponentInfo> = {
        myOpenTickets: () => ({ Component: MyOpenTickets, props: { title: GadgetTitle.OpenTicket } }),
        bookmarksList: () => ({ Component: MyBookmarks, props: { title: GadgetTitle.Bookmarks } }),
        myBookmarks: () => ({ Component: MyBookmarks, props: { title: GadgetTitle.Bookmarks } }),
        dateWiseWorklog: () => ({ Component: DateWiseWorklog, props: { title: GadgetTitle.DateWiseWorklog } }),
        dtWiseWL: () => ({ Component: DateWiseWorklog, props: { title: GadgetTitle.DateWiseWorklog } }),
        ticketWiseWorklog: () => ({ Component: TicketWiseWorklog, props: { title: GadgetTitle.TicketWiseWorklog } }),
        pendingWorklog: () => ({ Component: PendingWorklog, props: { title: GadgetTitle.PendingWorklog } }),
        pendingWL: () => ({ Component: PendingWorklog, props: { title: GadgetTitle.PendingWorklog } }),
        myFilters: () => ({ Component: MyReports, props: { title: GadgetTitle.MyReports } }),
        worklogBarChart: () => ({ Component: WorklogBarChartGadget, props: { title: GadgetTitle.WorklogBarChart } }),
        sWiseTSpent: () => ({ Component: StatusWiseTimeSpent, props: { title: GadgetTitle.StatusWiseTimeSpent } }),
        teamWorklogReport: () => ({ Component: WorklogReport, props: { title: GadgetTitle.WorklogReport } }),

        agendaDay: () => ({
            Component: CalendarGadget,
            props: { viewMode: 'timeGridDay', title: 'Calendar - Day' },
        }),
        agendaWeek: () => ({
            Component: CalendarGadget,
            props: { viewMode: 'timeGridWeek', title: 'Calendar - Week' },
        }),
        listDay: () => ({
            Component: CalendarGadget,
            props: { viewMode: 'listDay', title: 'Calendar - Day List' },
        }),
        listWeek: () => ({
            Component: CalendarGadget,
            props: { viewMode: 'listWeek', title: 'Calendar - Week List' },
        }),
        listMonth: () => ({
            Component: CalendarGadget,
            props: { viewMode: 'listMonth', title: 'Calendar - Month List' },
        }),

        CR: () => unavailableReport('Custom report', opts[1]),
        AR: () => unavailableReport('Advanced report', opts[1]),
        SQ: () => unavailableReport('Saved query', opts[1]),
    };

    const gadgetFactory = gadgetMap[gadgetName];

    if (!gadgetFactory) {
        return {
            Component: BaseGadgetUnavailable,
            props: { title: 'Unknown Gadget' },
        };
    }

    return gadgetFactory();
}
