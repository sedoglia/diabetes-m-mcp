/**
 * Authentication Module for Diabetes:M Analytics
 *
 * Handles:
 * - Login with username/password
 * - Session management
 * - Token refresh
 * - Automatic re-authentication
 */

import {
  API_BASE_URL,
  ENDPOINTS,
  DEFAULT_HEADERS,
  REQUEST_TIMEOUT,
  ERROR_CODES
} from './endpoints.js';
import { credentialsManager } from '../security/credentials.js';
import { auditLogger } from '../security/audit.js';
import type { LoginResponse, ApiResponse } from '../types/api.js';

interface AuthState {
  accessToken: string | null;
  sessionId: string | null;
  cookies: string[];
  isAuthenticated: boolean;
  lastAuth: Date | null;
}

/**
 * Authentication Manager
 */
class AuthManager {
  private state: AuthState = {
    accessToken: null,
    sessionId: null,
    cookies: [],
    isAuthenticated: false,
    lastAuth: null
  };

  /**
   * Attempts to login with stored credentials or provided credentials
   */
  async login(email?: string, password?: string): Promise<boolean> {
    const timer = auditLogger.startTimer();

    try {
      // Get credentials
      let creds: { email: string; password: string } | null;

      if (email && password) {
        creds = { email, password };
        // Store for future use
        await credentialsManager.storeCredentials(email, password);
      } else {
        creds = await credentialsManager.getCredentials();
      }

      if (!creds) {
        auditLogger.logOperation('login', undefined, false, timer(), undefined, ERROR_CODES.AUTHENTICATION_FAILED);
        throw new Error('No credentials available. Please provide email and password.');
      }

      // Try to restore session from stored tokens first
      const storedTokens = await credentialsManager.getTokens();
      if (storedTokens) {
        const isValid = await this.verifySession(storedTokens.accessToken, storedTokens.sessionId);
        if (isValid) {
          this.state.accessToken = storedTokens.accessToken;
          this.state.sessionId = storedTokens.sessionId || null;
          this.state.isAuthenticated = true;
          this.state.lastAuth = new Date();

          auditLogger.logOperation('login', undefined, true, timer(), 'restored_session');
          return true;
        }
      }

      // Perform fresh login
      const response = await this.performLogin(creds.email, creds.password);

      if (response.success && response.token) {
        this.state.accessToken = response.token;
        this.state.sessionId = response.sessionId || null;
        this.state.isAuthenticated = true;
        this.state.lastAuth = new Date();

        // Store tokens for future sessions
        await credentialsManager.storeTokens(
          response.token,
          response.sessionId,
          new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h expiry
        );

        auditLogger.logOperation('login', undefined, true, timer());
        return true;
      }

      auditLogger.logOperation('login', undefined, false, timer(), undefined, ERROR_CODES.AUTHENTICATION_FAILED);
      return false;
    } catch (error) {
      auditLogger.logOperation('login', undefined, false, timer(), undefined, ERROR_CODES.AUTHENTICATION_FAILED);
      throw error;
    }
  }

  /**
   * Performs the actual login request
   *
   * The Diabetes:M API expects:
   * - username: email or username
   * - password: user password
   * - device: 'web'
   * - client: 'web'
   */
  private async performLogin(email: string, password: string): Promise<LoginResponse> {
    const url = `${API_BASE_URL}${ENDPOINTS.LOGIN}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // API expects username, device, and client fields
    const loginPayload = {
      username: email,
      password: password,
      device: 'web',
      client: 'web'
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...DEFAULT_HEADERS,
          'Origin': API_BASE_URL,
          'Referer': `${API_BASE_URL}/`
        },
        body: JSON.stringify(loginPayload),
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Capture cookies from response
      // The API sets a jwt-token cookie that is required for all subsequent requests
      // getSetCookie() is supported in Node 18.14.1+ and modern browsers
      let setCookies: string[] = [];
      if (typeof response.headers.getSetCookie === 'function') {
        setCookies = response.headers.getSetCookie();
      } else {
        // Fallback for older Node versions
        const rawCookies = response.headers.get('set-cookie');
        if (rawCookies) {
          // Split on comma but be careful with expires dates
          setCookies = rawCookies.split(/,(?=[^;]+=[^;]+)/).map(c => c.trim());
        }
      }

      if (setCookies.length > 0) {
        // Extract just the name=value part from each cookie (before any ;)
        this.state.cookies = setCookies.map(cookie => {
          const parts = cookie.split(';');
          return parts[0]?.trim() || cookie;
        });
      }

      if (!response.ok) {
        // Handle common error cases
        if (response.status === 401) {
          return { success: false, error: 'Invalid email or password' };
        }
        if (response.status === 429) {
          return { success: false, error: 'Too many login attempts. Please try again later.' };
        }
        return { success: false, error: `Login failed with status ${response.status}` };
      }

      // Parse the response - API returns token and user_id directly
      const data = await response.json() as Record<string, unknown>;

      // The API returns { token: "...", user_id: 1234, ... } directly
      if (data.token && typeof data.token === 'string') {
        const userId = data.user_id || data.userId;
        return {
          success: true,
          token: data.token,
          sessionId: undefined,
          userId: typeof userId === 'number' ? userId : undefined
        };
      }

      // Handle wrapped response format
      if (data.success && data.data && typeof data.data === 'object') {
        const inner = data.data as Record<string, unknown>;
        return {
          success: true,
          token: inner.token as string,
          sessionId: inner.sessionId as string | undefined,
          userId: inner.userId as number | undefined
        };
      }

      return { success: false, error: (data.error as string) || 'Login failed' };
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Login request timed out' };
        }
        return { success: false, error: error.message };
      }

      return { success: false, error: 'Unknown error during login' };
    }
  }

  /**
   * Verifies if a session is still valid
   */
  private async verifySession(token: string, sessionId?: string): Promise<boolean> {
    const url = `${API_BASE_URL}${ENDPOINTS.VERIFY_SESSION}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...DEFAULT_HEADERS,
          'Authorization': `Bearer ${token}`,
          ...(sessionId ? { 'X-Session-Id': sessionId } : {})
        }
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Gets authentication headers for API requests
   * Includes cookies which are REQUIRED by the Diabetes:M API
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      'Origin': API_BASE_URL,
      'Referer': `${API_BASE_URL}/`
    };

    if (this.state.accessToken) {
      headers['Authorization'] = `Bearer ${this.state.accessToken}`;
    }

    if (this.state.sessionId) {
      headers['X-Session-Id'] = this.state.sessionId;
    }

    // Cookies are REQUIRED - the API returns "Missing authentication cookie" without them
    if (this.state.cookies.length > 0) {
      headers['Cookie'] = this.state.cookies.join('; ');
    }

    return headers;
  }

  /**
   * Checks if currently authenticated
   */
  isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  /**
   * Gets current access token
   */
  getAccessToken(): string | null {
    return this.state.accessToken;
  }

  /**
   * Logs out and clears session
   */
  async logout(): Promise<void> {
    const timer = auditLogger.startTimer();

    try {
      if (this.state.accessToken) {
        // Try to logout on server
        const url = `${API_BASE_URL}${ENDPOINTS.LOGOUT}`;
        await fetch(url, {
          method: 'POST',
          headers: this.getAuthHeaders()
        }).catch(() => {
          // Ignore logout errors
        });
      }

      // Clear local state
      this.state = {
        accessToken: null,
        sessionId: null,
        cookies: [],
        isAuthenticated: false,
        lastAuth: null
      };

      // Clear stored tokens
      await credentialsManager.deleteTokens();

      auditLogger.logOperation('logout', undefined, true, timer());
    } catch (error) {
      auditLogger.logOperation('logout', undefined, false, timer(), undefined, ERROR_CODES.UNKNOWN_ERROR);
    }
  }

  /**
   * Ensures we are authenticated, attempting login if needed
   */
  async ensureAuthenticated(): Promise<void> {
    if (!this.state.isAuthenticated) {
      const success = await this.login();
      if (!success) {
        throw new Error('Authentication required. Please configure credentials first.');
      }
    }
  }

  /**
   * Handles authentication errors and attempts re-authentication
   */
  async handleAuthError(): Promise<boolean> {
    // Clear current auth state
    this.state.isAuthenticated = false;
    this.state.accessToken = null;
    await credentialsManager.deleteTokens();

    // Try to re-authenticate with stored credentials
    return this.login();
  }
}

// Singleton instance
export const authManager = new AuthManager();
