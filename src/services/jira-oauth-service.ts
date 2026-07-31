import { decryptText, encryptText, isEncryptedCredential } from '@/common';
import { ApiUrls, jaJiraTokenExchangeUrl } from '@/constants';
import { clearEnd } from '@/utils';

import type AjaxRequestService from './ajax-request-service';
import type SettingsService from './settings-service';
import type UserService from './user-service';

function getBearerTokenHeader(token: string): any {
    return { Authorization: `Bearer ${token}`, withCredentials: false };
}

function getBasicTokenHeader(uid: string, pwd: string): any {
    return { Authorization: `Basic ${btoa(`${uid}:${pwd}`)}`, withCredentials: false };
}

export default class JiraAuthService {
    static dependencies = ['AjaxRequestService', 'SettingsService', 'UserService'];

    private $request: AjaxRequestService;
    private $settings: SettingsService;
    private $user: UserService;
    private _tokenRefreshRunning?: Promise<any>;

    constructor($request: AjaxRequestService, $settings: SettingsService, $user: UserService) {
        this.$request = $request;
        this.$settings = $settings;
        this.$user = $user;
    }

    async integrateWithCred(url: string, uid: string, pwd: string): Promise<number> {
        const profile = await this.$request.execute(
            'GET',
            clearEnd(url, '/') + ApiUrls.mySelf.substring(1),
            null,
            getBasicTokenHeader(uid, pwd),
        );

        const encryptedPwd = await encryptText(pwd);

        const userId = await this.$user.createUser(profile, url, { authType: 'C', uid, pwd: encryptedPwd });

        //await this.$settings.set("CurrentJiraUrl", url);
        await this.$settings.set('CurrentUserId', userId);

        return userId;
    }

    /**
     * Integrate using a Personal Access Token (Jira Server / Data Center 8.14+).
     * The token is sent as a Bearer header and no password is ever stored.
     */
    async integrateWithPAT(url: string, token: string): Promise<number> {
        const profile = await this.$request.execute(
            'GET',
            clearEnd(url, '/') + ApiUrls.mySelf.substring(1),
            null,
            getBearerTokenHeader(token),
        );

        const encryptedToken = await encryptText(token);

        const userId = await this.$user.createUser(profile, url, { authType: 'T', pwd: encryptedToken });

        await this.$settings.set('CurrentUserId', userId);

        return userId;
    }

    async integrate(code: string): Promise<any> {
        try {
            return {
                success: true,
                userId: await this.getAndSaveToken(code),
            };
        } catch (err: any) {
            console.error('Integration failed: ', err);
            return { success: false, message: err.message };
        }
    }

    // This function returns userid when it is not passed
    // and returns bearer token when user id is passed
    async getAndSaveToken(authCode?: string, refreshToken?: string, userId?: number): Promise<any> {
        const returnUserId = !userId;
        let result: any;

        try {
            result = await this.$request.execute(
                'GET',
                jaJiraTokenExchangeUrl,
                null,
                authCode
                    ? { withCredentials: false, 'jira-auth-code': authCode }
                    : { withCredentials: false, 'jira-refresh-token': refreshToken },
            );
        } catch (ex) {
            console.error('Error fetching jira cloud auth token', ex);
            throw ex;
        }

        const { success, message, token, refresh_token, expires_at: expires, jiraUrl, cloudId, apiUrl } = result;

        if (success) {
            if (!userId) {
                const profile = await this.$request.execute(
                    'GET',
                    clearEnd(apiUrl, '/') + ApiUrls.mySelf.substring(1),
                    null,
                    getBearerTokenHeader(token),
                );
                userId = await this.$user.createUser(profile, jiraUrl, apiUrl);
            }
            await this.saveTokenData(userId, token, expires, refresh_token, cloudId);

            return returnUserId ? userId : { token, expires };
        } else {
            throw Error(message);
        }
    }

    async saveTokenData(userId: number, token: string, expires: number, refresh_token: string, cloudId: string): Promise<void> {
        await this.$settings.saveGeneralSetting(userId, 'JOAT', { token, expires });
        await this.$settings.saveGeneralSetting(userId, 'JOART', refresh_token);
        await this.$settings.saveGeneralSetting(userId, 'JiraCloudId', cloudId);
    }

    async transformHeaders(userId?: number, headers?: any): Promise<any> {
        const { noAuthHeaders, ...customHeaders } = headers || {};

        if (!userId || noAuthHeaders) {
            return typeof headers === 'object' ? customHeaders : headers;
        }

        const user = await this.$user.getUser(userId);
        if (user.authType === 'C' || user.authType === 'T') {
            const secret = user.pwd && (await decryptText(user.pwd));

            // Transparently upgrade credentials stored by older versions with plain base64
            if (user.pwd && secret && !isEncryptedCredential(user.pwd)) {
                encryptText(secret)
                    .then((encrypted) => this.$user.updateUserCredential(userId, encrypted))
                    .catch((err) => console.warn('Unable to upgrade stored credential encryption', err));
            }

            const authHeader = user.authType === 'T' ? getBearerTokenHeader(secret) : getBasicTokenHeader(user.uid, secret);

            return { ...customHeaders, ...authHeader };
        } else if (user.apiUrl) {
            let auth = await this.$settings.getGeneralSetting(userId, 'JOAT');
            if (auth) {
                if (this._tokenRefreshRunning) {
                    await this._tokenRefreshRunning;
                }
                if (auth.expires <= new Date().getTime()) {
                    const refreshToken = await this.$settings.getGeneralSetting(userId, 'JOART');
                    this._tokenRefreshRunning = this.getAndSaveToken(undefined, refreshToken, userId);
                    auth = await this._tokenRefreshRunning;
                    delete this._tokenRefreshRunning;
                }

                const { token } = auth;

                return { ...customHeaders, ...getBearerTokenHeader(token) };
            }
        }

        return customHeaders;
    }
}
