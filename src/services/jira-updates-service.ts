import { defaultSettings } from '@/constants';

import { getUserName } from '@utils';

import type JiraService from './jira-service';
import type SessionService from './session-service';
import type UserUtilsService from './userutils-service';

export interface RecentUpdatesOptions {
    /** List the current user's own changes instead of everyone else's */
    mine?: boolean;
    maxResults?: number;
}

/**
 * Tickets the current user is likely to administer. Server / DC has no JQL operator for
 * "changed by me", so involvement is approximated and the change author is then matched
 * against the change log itself.
 */
const MY_ACTIVITY_JQL =
    '(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updatedDate >= $date$ ORDER BY updated DESC';

/** Used when the instance rejects the watcher clause (watching disabled) */
const MY_ACTIVITY_JQL_NO_WATCHER =
    '(assignee = currentUser() OR reporter = currentUser()) AND updatedDate >= $date$ ORDER BY updated DESC';

export default class JiraUpdatesService {
    static dependencies = ['JiraService', 'UserUtilsService', 'SessionService'];

    private $jira: JiraService;
    private $userutils: UserUtilsService;
    private $session: SessionService;

    constructor($jira: JiraService, $userutils: UserUtilsService, $session: SessionService) {
        this.$jira = $jira;
        this.$userutils = $userutils;
        this.$session = $session;
    }

    async getRescentUpdates(from: number | string | Date = 7, options?: RecentUpdatesOptions): Promise<any> {
        const mine = options?.mine === true;

        if (!from) {
            from = '-3d';
        }
        if (from instanceof Date) {
            const year = from.getFullYear();
            const month = String(from.getMonth() + 1).padStart(2, '0');
            const day = String(from.getDate()).padStart(2, '0');
            const hours = String(from.getHours()).padStart(2, '0');
            const minutes = String(from.getMinutes()).padStart(2, '0');
            from = `"${year}-${month}-${day} ${hours}:${minutes}"`;
        } else if (typeof from === 'number') {
            from = `-${from}d`;
        }

        // The configured "Jira updates" JQL is built around lastViewed ("what have I not seen"),
        // which is the wrong lens for reviewing your own activity — you have obviously seen it.
        const jqlTemplate = mine
            ? MY_ACTIVITY_JQL
            : this.$session?.CurrentUser?.jiraUpdatesJQL || defaultSettings.jiraUpdatesJQL;
        const jql = jqlTemplate.replace(/\$date\$/g, from as string);

        const maxResults = options?.maxResults || (mine ? 100 : 15);
        const searchFields = ['key', 'lastViewed', 'updated', 'changeLog', 'summary', 'assignee', 'reporter', 'comments'];

        let issues: any[];
        try {
            issues = await this.$jira.searchTickets(jql, searchFields, undefined, {
                expand: ['changelog'],
                maxResults,
                ignoreWarnings: mine,
                ignoreErrors: mine,
            });
        } catch (err) {
            // Watching can be switched off instance-wide, which makes "watcher" an invalid JQL
            // field; fall back to assignee / reporter only rather than failing the whole view
            if (!mine) {
                throw err;
            }

            console.warn('My-activity search failed. Retrying without the watcher clause.', err);
            const fallbackJql = MY_ACTIVITY_JQL_NO_WATCHER.replace(/\$date\$/g, from as string);
            issues = await this.$jira.searchTickets(fallbackJql, searchFields, undefined, {
                expand: ['changelog'],
                maxResults,
                ignoreWarnings: true,
            });
        }

        const updatedIssues = issues
            .filter((i: any) => {
                if (!i.changelog?.histories) return false;
                if (mine) return true;
                if (!i.fields?.lastViewed) return true;
                const updatedDate = new Date(i.fields?.updated);
                const lastViewedDate = new Date(i.fields?.lastViewed);
                return updatedDate > lastViewedDate;
            })
            .map((i: any) => {
                const {
                    changelog: { histories } = {},
                    key,
                    fields: { summary, assignee, reporter, lastViewed },
                } = i;
                return { key, summary, assignee, reporter, lastViewed, histories };
            });

        const fields = await this.$jira.getCustomFields();
        const fieldNames = fields.reduce((obj: any, { id, name }: any) => {
            obj[id] = name;
            return obj;
        }, {});

        // Match on the Jira user name rather than the e-mail address: Server / DC hides
        // emailAddress under its privacy settings, which would make every author comparison fail
        const currentUserName = (getUserName(this.$session.CurrentUser?.jiraUser || {}, true) || '').toLowerCase();

        const notifications = this.extractUpdates(updatedIssues, currentUserName, fieldNames, { mine });

        const groupedByKey: { [key: string]: any[] } = {};
        notifications.forEach((n: any) => {
            if (!groupedByKey[n.key]) {
                groupedByKey[n.key] = [];
            }
            groupedByKey[n.key].push(n);
        });

        const list = Object.keys(groupedByKey).map((key) => {
            const values = groupedByKey[key];
            const updates = values.sort((a: any, b: any) => b.sortBy - a.sortBy);
            const { date, sortBy, summary, reason } = updates[0];
            return { key, href: this.$userutils.getTicketUrl(key), date, sortBy, summary, reason, updates };
        });

        return { list, total: notifications.length, ticketCount: list.length };
    }

    extractUpdates(issues: any[], currentUserName: string, fieldNames: any, options?: { mine?: boolean }): any[] {
        const result: any[] = [];
        const mine = options?.mine === true;
        const isCurrentUser = (user: any) => !!currentUserName && getUserName(user || {}, true) === currentUserName;

        issues.forEach(({ key, summary, assignee, reporter, lastViewed, histories, comments }: any) => {
            let reason = '';
            if (isCurrentUser(assignee)) {
                reason = 'assigned to you';
            } else if (isCurrentUser(reporter)) {
                reason = 'reported by you';
            }

            if (histories?.length) {
                histories.forEach(({ author, created, items }: any) => {
                    const createdDate = created && new Date(created);
                    const authorMatches = isCurrentUser(author);

                    // "mine" keeps only my own changes; the default view keeps everyone else's
                    // and additionally hides anything already seen
                    if (
                        (mine ? authorMatches : !authorMatches) &&
                        (mine || !createdDate || !lastViewed || createdDate > new Date(lastViewed))
                    ) {
                        const date = createdDate;
                        const sortBy = date.getTime();
                        items.forEach(({ field, fieldId, fromString, toString }: any) => {
                            if (!fromString) {
                                fromString = 'NONE';
                            }
                            // Changelog items carry the field id for custom fields and the display
                            // name for system fields, so both have to be tried before falling back
                            const fieldName = fieldNames[fieldId] || fieldNames[field] || field;
                            result.push({ date, sortBy, author, field: fieldName, fromString, toString, key, summary, reason });
                        });
                    }
                });
            }

            if (comments?.length) {
                // ToDo:
            }
        });

        return result;
    }
}
