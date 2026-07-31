import { defaultSettings } from '@/constants';

import { getUserName } from '@utils';

import type JiraService from './jira-service';
import type SessionService from './session-service';
import type UserUtilsService from './userutils-service';

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

    async getRescentUpdates(from: number | string | Date = 7): Promise<any> {
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

        const jql = (this.$session?.CurrentUser?.jiraUpdatesJQL || defaultSettings.jiraUpdatesJQL).replace(/\$date\$/g, from as string);

        const maxResults = 15;
        const issues = await this.$jira.searchTickets(
            jql,
            ['key', 'lastViewed', 'updated', 'changeLog', 'summary', 'assignee', 'reporter', 'comments'],
            undefined,
            { expand: ['changelog'], maxResults },
        );

        const updatedIssues = issues
            .filter((i: any) => {
                if (!i.changelog?.histories) return false;
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
        // emailAddress under its privacy settings, which makes every author comparison fail
        const notifications = this.extractUpdates(
            updatedIssues,
            (getUserName(this.$session.CurrentUser?.jiraUser || {}, true) || '').toLowerCase(),
            fieldNames,
        );

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

    extractUpdates(issues: any[], currentUserName: string, fieldNames: any): any[] {
        const result: any[] = [];
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
                    if (!isCurrentUser(author) && (!createdDate || !lastViewed || createdDate > new Date(lastViewed))) {
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
