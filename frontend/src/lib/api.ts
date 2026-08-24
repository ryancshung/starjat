const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `請求失敗 (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Auth
  register: (body: {
    email: string;
    password: string;
    name: string;
    role?: 'PARENT' | 'CHILD';
    inviteCode?: string;
  }) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () => request<{ user: User & { memberships: Membership[] } }>('/api/auth/me'),

  // Families
  createFamily: (name: string) =>
    request<{ family: Family }>('/api/families', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  joinFamily: (inviteCode: string) =>
    request<{ family: Family }>('/api/families/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    }),

  getMyFamily: () => request<{ family: Family | null }>('/api/families/me'),

  updateMyFamily: (name: string) =>
    request<{ family: Family }>('/api/families/me', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  removeMember: (userId: string) =>
    request<{ success: boolean }>(`/api/families/members/${userId}`, {
      method: 'DELETE',
    }),

  // Points
  awardPoints: (userId: string, amount: number, reason: string) =>
    request('/api/points/award', {
      method: 'POST',
      body: JSON.stringify({ userId, amount, reason }),
    }),

  getPointHistory: (userId?: string) =>
    request<{ transactions: PointTransaction[] }>(
      `/api/points/history${userId ? `?userId=${userId}` : ''}`
    ),

  getBalance: () => request<{ points: number }>('/api/points/balance'),

  // Tasks
  getTasks: () => request<{ tasks: Task[] }>('/api/tasks'),

  createTask: (data: {
    title: string;
    description?: string;
    points: number;
    isRecurring?: boolean;
    recurringType?: 'daily' | 'weekly';
  }) =>
    request<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTask: (id: string, data: Partial<Pick<Task, 'title' | 'description' | 'points' | 'isRecurring' | 'recurringType'>>) =>
    request<{ task: Task }>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteTask: (id: string) =>
    request<{ success: boolean; archived: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  completeTask: (id: string, note?: string) =>
    request(`/api/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  reviewTaskCompletion: (id: string, status: 'APPROVED' | 'REJECTED') =>
    request(`/api/tasks/completions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  getPendingTasks: () =>
    request<{ completions: TaskCompletion[] }>('/api/tasks/pending'),

  // Rewards
  getRewards: () => request<{ rewards: Reward[] }>('/api/rewards'),

  createReward: (data: {
    title: string;
    description?: string;
    cost: number;
  }) =>
    request<{ reward: Reward }>('/api/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateReward: (id: string, data: Partial<Pick<Reward, 'title' | 'description' | 'cost'>>) =>
    request<{ reward: Reward }>(`/api/rewards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteReward: (id: string) =>
    request<{ success: boolean; archived: boolean }>(`/api/rewards/${id}`, { method: 'DELETE' }),

  redeemReward: (id: string) =>
    request(`/api/rewards/${id}/redeem`, { method: 'POST' }),

  reviewRedemption: (id: string, status: 'APPROVED' | 'REJECTED') =>
    request(`/api/rewards/redemptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  getPendingRedemptions: () =>
    request<{ redemptions: RewardRedemption[] }>('/api/rewards/pending'),

  // Admin
  getUsers: () => request<{ users: User[] }>('/api/admin/users'),
  getFamilies: () => request<{ families: Family[] }>('/api/admin/families'),
  deleteUser: (id: string) =>
    request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  updateUserRole: (id: string, role: User['role']) =>
    request<{ user: Pick<User, 'id' | 'role'> }>(`/api/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  updateFamily: (id: string, name: string) =>
    request<{ family: Family }>(`/api/admin/families/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteFamily: (id: string) => request<{ success: boolean }>(`/api/admin/families/${id}`, { method: 'DELETE' }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
  points: number;
}

export interface Membership {
  family: { id: string; name: string; inviteCode: string };
}

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  members: {
    id: string;
    user: User;
  }[];
}

export interface PointTransaction {
  id: string;
  amount: number;
  type: 'EARN' | 'SPEND' | 'ADJUST';
  reason: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  points: number;
  isRecurring: boolean;
  recurringType?: string;
  completions?: TaskCompletion[];
}

export interface TaskCompletion {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  completedAt: string;
  task: Task;
  user: { id: string; name: string };
}

export interface Reward {
  id: string;
  title: string;
  description?: string;
  cost: number;
}

export interface RewardRedemption {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reward: Reward;
  user: { id: string; name: string; points: number };
}
