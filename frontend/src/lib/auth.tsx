import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { api, setToken, User } from './api';

const USER_CACHE_KEY = 'auth-user';
function readCachedUser(): User | null {
  try {
    const value = localStorage.getItem(USER_CACHE_KEY);
    if (!value) return null;
    const user = JSON.parse(value) as User;
    return user && typeof user.id === 'string' && typeof user.role === 'string' ? user : null;
  } catch { return null; }
}
function cacheUser(user: User | null) {
  if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_CACHE_KEY);
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    role?: 'PARENT' | 'CHILD';
    inviteCode?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const { user, token } = await api.me();
    if (token) setToken(token);
    setUser(user);
    cacheUser(user);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser().catch(() => undefined).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    const refreshWhenOnline = () => { if (localStorage.getItem('token')) refreshUser().catch(() => undefined); };
    window.addEventListener('online', refreshWhenOnline);
    return () => window.removeEventListener('online', refreshWhenOnline);
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user } = await api.login({ email, password });
    setToken(token);
    setUser(user);
    cacheUser(user);
  };

  const register = async (data: {
    email: string;
    password: string;
    name: string;
    role?: 'PARENT' | 'CHILD';
    inviteCode?: string;
  }) => {
    const { token, user } = await api.register(data);
    setToken(token);
    setUser(user);
    cacheUser(user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    cacheUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
