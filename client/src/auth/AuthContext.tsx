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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const accessToken = useRef('');
  const refreshPromise = useRef<Promise<string> | null>(null);

  const clearSession = useCallback(() => {
    accessToken.current = '';
    setUser(null);
    setStatus('unauthenticated');
    localStorage.removeItem('moataz_token');
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
    void (async () => {
      const legacyToken = localStorage.getItem('moataz_token') ?? '';
      localStorage.removeItem('moataz_token');
      try {
        let token = legacyToken;
        if (!token) token = await refresh();
        let currentUser: SessionUser;
        try {
          currentUser = await loadMe(token);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401 || !legacyToken) throw error;
          token = await refresh();
          currentUser = await loadMe(token);
        }
        accessToken.current = token;
        setUser(currentUser);
        setStatus('authenticated');
      } catch {
        clearSession();
      }
    })();
  }, [clearSession, loadMe, refresh]);

  const login = useCallback(async (input: LoginInput): Promise<void> => {
    const response = await apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    accessToken.current = response.accessToken;
    setUser(response.user);
    setStatus('authenticated');
  }, []);

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
      return await execute(accessToken.current);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      try {
        const token = await refresh();
        const result = await execute(token);
        if (status !== 'authenticated') {
          const currentUser = await loadMe(token);
          setUser(currentUser);
          setStatus('authenticated');
        }
        return result;
      } catch (refreshError) {
        clearSession();
        throw refreshError;
      }
    }
  }, [clearSession, loadMe, refresh, status]);

  return <AuthContext.Provider value={{ status, user, login, logout, request }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
