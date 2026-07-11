import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError, type ApiRequestOptions } from '../lib/api';

export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'user' };
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
type LoginInput = { email: string; password: string };
type LoginResponse = { accessToken: string; token: string; expiresIn: number; user: SessionUser };
type RefreshResponse = { accessToken: string; token: string; expiresIn: number };
type MeResponse = { user: SessionUser };

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_CACHE_KEY = 'moataz_session_user';
const sessionErrorCodes = new Set(['unauthorized', 'invalid_token', 'session_expired', 'refresh_token_invalid']);

function cachedUser(): SessionUser | null {
  try {
    const value = JSON.parse(localStorage.getItem(USER_CACHE_KEY) ?? 'null') as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== 'string'
      || typeof record.email !== 'string'
      || typeof record.name !== 'string'
      || (record.role !== 'admin' && record.role !== 'user')
    ) return null;
    return record as SessionUser;
  } catch {
    return null;
  }
}

function isSessionUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && sessionErrorCodes.has(error.code);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const accessToken = useRef('');
  const refreshPromise = useRef<Promise<string> | null>(null);

  const rememberUser = useCallback((next: SessionUser) => {
    setUser(next);
    setStatus('authenticated');
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(next));
  }, []);

  const clearSession = useCallback(() => {
    accessToken.current = '';
    setUser(null);
    setStatus('unauthenticated');
    localStorage.removeItem('moataz_token');
    localStorage.removeItem(USER_CACHE_KEY);
  }, []);

  const refresh = useCallback(async (): Promise<string> => {
    if (!refreshPromise.current) {
      refreshPromise.current = apiRequest<RefreshResponse>('/api/auth/refresh', { method: 'POST', body: '{}' })
        .then((response) => {
          accessToken.current = response.accessToken;
          return response.accessToken;
        })
        .finally(() => { refreshPromise.current = null; });
    }
    return refreshPromise.current;
  }, []);

  const loadMe = useCallback(async (token: string): Promise<SessionUser> => {
    const response = await apiRequest<MeResponse>('/api/auth/me', { accessToken: token });
    return response.user;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const legacyToken = localStorage.getItem('moataz_token') ?? '';
      localStorage.removeItem('moataz_token');
      const fallbackUser = cachedUser();
      try {
        let token = legacyToken;
        if (!token) token = await refresh();
        let currentUser: SessionUser;
        try {
          currentUser = await loadMe(token);
        } catch (error) {
          if (!isSessionUnauthorized(error) || !legacyToken) throw error;
          token = await refresh();
          currentUser = await loadMe(token);
        }
        if (cancelled) return;
        accessToken.current = token;
        rememberUser(currentUser);
      } catch (error) {
        if (cancelled) return;
        if (isSessionUnauthorized(error)) {
          clearSession();
          return;
        }
        if (fallbackUser) {
          rememberUser(fallbackUser);
          return;
        }
        setStatus('unauthenticated');
      }
    })();
    return () => { cancelled = true; };
  }, [clearSession, loadMe, refresh, rememberUser]);

  const login = useCallback(async (input: LoginInput): Promise<void> => {
    const response = await apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    accessToken.current = response.accessToken;
    rememberUser(response.user);
  }, [rememberUser]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const execute = (token: string) => apiRequest<T>(path, { ...options, accessToken: token } as ApiRequestOptions);
    try {
      const token = accessToken.current || await refresh();
      return await execute(token);
    } catch (error) {
      if (!isSessionUnauthorized(error)) throw error;
      try {
        const token = await refresh();
        const result = await execute(token);
        if (status !== 'authenticated') rememberUser(await loadMe(token));
        return result;
      } catch (refreshError) {
        if (isSessionUnauthorized(refreshError)) clearSession();
        throw refreshError;
      }
    }
  }, [clearSession, loadMe, refresh, rememberUser, status]);

  return <AuthContext.Provider value={{ status, user, login, logout, request }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
