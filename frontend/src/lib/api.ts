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

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    signal: options.signal ?? controller.signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `請求失敗 (${res.status})`);
  }
  return data as T;
  } finally { window.clearTimeout(timer); }
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

  updateFamilySettings: (data: { timezone?: string; pointsPerTwd?: number | null }) =>
    request<{ family: Family }>('/api/families/settings', { method: 'PUT', body: JSON.stringify(data) }),

  updateMemberSettings: (userId: string, data: { canDeductPoints?: boolean; monthlyAllowanceLimitTwd?: number | null }) =>
    request<{ membership: Pick<Family['members'][number], 'canDeductPoints' | 'monthlyAllowanceLimitTwd'> }>(`/api/families/members/${userId}/settings`, { method: 'PUT', body: JSON.stringify(data) }),

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

  deductPoints: (userId: string, amount: number, reason: string) =>
    request('/api/points/deduct', { method: 'POST', body: JSON.stringify({ userId, amount, reason }) }),

  reverseDeduction: (transactionId: string, reason: string) =>
    request(`/api/points/transactions/${transactionId}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),

  getPointHistory: (userId?: string) =>
    request<{ transactions: PointTransaction[] }>(
      `/api/points/history${userId ? `?userId=${userId}` : ''}`
    ),

  getBalance: () => request<PointBalance>('/api/points/balance'),
  getScheduledAwards: () => request<{ schedules: ScheduledAward[] }>('/api/scheduled-awards'),
  createScheduledAward: (data: { userId:string; name:string; amount:number; frequency:ScheduledAward['frequency']; startAt?:string; localTime:string; weekday?:number|null; dayOfMonth?:number|null; isActive?:boolean }) => request<{ schedule: ScheduledAward }>('/api/scheduled-awards', { method:'POST', body:JSON.stringify(data) }),
  updateScheduledAward: (id:string, data: Partial<Omit<ScheduledAward, 'id' | 'lastPaidAt' | 'user'>>) => request<{ schedule: ScheduledAward }>(`/api/scheduled-awards/${id}`, { method:'PUT', body:JSON.stringify(data) }),
  deleteScheduledAward: (id:string) => request<{ success:boolean }>(`/api/scheduled-awards/${id}`, { method:'DELETE' }),

  // Tasks
  getTasks: () => request<{ tasks: Task[]; localDate: string }>('/api/tasks'),
  getChallenges: () => request<ChallengeData>('/api/tasks/challenges'),
  saveChallenge: (data: ChallengeInput, id?: string) => request(`/api/tasks/challenges${id ? `/${id}` : ''}`, { method:id?'PUT':'POST', body:JSON.stringify(data) }),
  fulfillChallengeAward: (id: string) => request(`/api/tasks/challenge-awards/${id}/fulfill`, { method:'PUT', body:'{}' }),

  createTask: (data: {
    title: string;
    description?: string;
    points: number;
    isRecurring?: boolean;
    recurringType?: 'daily' | 'weekly';
    keepAfterCompletion?: boolean;
    maxCompletions?: number | null;
    groupId?: string | null;
  }) =>
    request<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTask: (id: string, data: Partial<Pick<Task, 'title' | 'description' | 'points' | 'isRecurring' | 'recurringType' | 'keepAfterCompletion' | 'maxCompletions' | 'groupId'>>) =>
    request<{ task: Task }>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteTask: (id: string) =>
    request<{ success: boolean; archived: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  reorderTasks: (ids: string[]) => request<{ success: boolean }>('/api/tasks/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  getTaskGroups: () => request<{ groups: TaskGroup[] }>('/api/tasks/groups'),
  createTaskGroup: (name: string) => request<{ group: TaskGroup }>('/api/tasks/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateTaskGroup: (id: string, name: string) => request<{ group: TaskGroup }>(`/api/tasks/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteTaskGroup: (id: string) => request<{ success: boolean }>(`/api/tasks/groups/${id}`, { method: 'DELETE' }),

  completeTask: (id: string, note?: string, requestId?: string) =>
    request<{ completion: TaskCompletion }>(`/api/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ note, requestId }),
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
    keepAfterRedemption?: boolean;
    maxRedemptions?: number | null;
    discountPercent?: number | null;
    discountStart?: string | null;
    discountEnd?: string | null;
    availabilityMode?: Reward['availabilityMode'];
    availableStartTime?: string | null;
    availableEndTime?: string | null;
    availableDates?: string[];
  }) =>
    request<{ reward: Reward }>('/api/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateReward: (id: string, data: Partial<Pick<Reward, 'title' | 'description' | 'cost' | 'keepAfterRedemption' | 'maxRedemptions' | 'discountPercent' | 'discountStart' | 'discountEnd' | 'availabilityMode' | 'availableStartTime' | 'availableEndTime'>> & { availableDates?: string[] }) =>
    request<{ reward: Reward }>(`/api/rewards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteReward: (id: string) =>
    request<{ success: boolean; archived: boolean }>(`/api/rewards/${id}`, { method: 'DELETE' }),
  reorderRewards: (ids: string[]) => request<{ success: boolean }>('/api/rewards/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  setAllRewardDiscounts: (percent: number | null, start: string | null, end: string | null) => request<{ success: boolean }>('/api/rewards/discount/all', { method: 'PUT', body: JSON.stringify({ percent, start, end }) }),
  getWishes: () => request<{ wishes: Wish[] }>('/api/rewards/wishes'),
  createWish: (title: string, description?: string) => request<{ wish: Wish }>('/api/rewards/wishes', { method: 'POST', body: JSON.stringify({ title, description }) }),
  reviewWish: (id: string, status: 'APPROVED' | 'REJECTED', cost?: number) => request(`/api/rewards/wishes/${id}`, { method: 'PUT', body: JSON.stringify({ status, cost }) }),

  redeemReward: (id: string) =>
    request(`/api/rewards/${id}/redeem`, { method: 'POST' }),

  getMyRedemptions: () => request<{ redemptions: RewardRedemption[] }>('/api/rewards/redemptions/mine'),
  cancelRedemption: (id: string) => request(`/api/rewards/redemptions/${id}/cancel`, { method: 'POST' }),

  reviewRedemption: (id: string, status: 'APPROVED' | 'REJECTED') =>
    request(`/api/rewards/redemptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  getPendingRedemptions: () =>
    request<{ redemptions: RewardRedemption[] }>('/api/rewards/pending'),

  // Allowance
  getAllowance: () => request<{ requests: AllowanceRedemption[]; settings: AllowanceSettings | null }>('/api/allowance'),
  requestAllowance: (amountTwd: number) => request<{ request: AllowanceRedemption }>('/api/allowance', { method: 'POST', body: JSON.stringify({ amountTwd }) }),
  cancelAllowance: (id: string) => request(`/api/allowance/${id}/cancel`, { method: 'POST' }),
  getPendingAllowance: () => request<{ requests: AllowanceRedemption[] }>('/api/allowance/pending'),
  reviewAllowance: (id: string, status: 'APPROVED' | 'REJECTED') => request(`/api/allowance/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Reports
  getMonthlyReport: (month: string, userId?: string) => request<MonthlyReport>(`/api/reports/monthly?month=${encodeURIComponent(month)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),

  // Trophies
  getTrophies: (userId?: string) => request<{ trophies: Trophy[] }>(`/api/trophies${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  createTrophy: (data: TrophyInput) => request<{ trophy: Trophy }>('/api/trophies', { method: 'POST', body: JSON.stringify(data) }),
  updateTrophy: (id: string, data: Partial<TrophyInput>) => request<{ trophy: Trophy }>(`/api/trophies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  awardTrophy: (id: string, userId: string) => request(`/api/trophies/${id}/award`, { method: 'POST', body: JSON.stringify({ userId }) }),

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
  ownerId: string;
  timezone: string;
  pointsPerTwd?: number | null;
  members: {
    id: string;
    canDeductPoints: boolean;
    monthlyAllowanceLimitTwd?: number | null;
    user: User;
  }[];
}

export interface PointTransaction {
  id: string;
  amount: number;
  type: 'EARN' | 'SPEND' | 'DEDUCT' | 'REVERSAL' | 'ADJUST';
  reason: string;
  createdAt: string;
  createdBy?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  reversalOfId?: string | null;
}
export interface PointBalance { points:number; reservedPoints:number; availablePoints:number; }
export interface ScheduledAward { id:string; userId:string; name:string; amount:number; frequency:'daily'|'weekly'|'monthly'; startAt:string; localTime:string; weekday?:number|null; dayOfMonth?:number|null; nextRunAt?:string|null; lastPaidAt?:string|null; isActive:boolean; user?:{id:string;name:string}; }

export interface Task {
  myStatus?: 'READY' | 'PENDING' | 'APPROVED';
  nextConfig?: Task;
  id: string;
  title: string;
  description?: string;
  points: number;
  isRecurring: boolean;
  recurringType?: string;
  keepAfterCompletion: boolean;
  maxCompletions?: number | null;
  groupId?: string | null;
  group?: TaskGroup | null;
  completions?: TaskCompletion[];
}

export interface TaskCompletion {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  completedAt: string;
  localDate?: string | null;
  pointsSnapshot?: number | null;
  titleSnapshot?: string | null;
  task: Task;
  user: { id: string; name: string };
}

export interface Reward {
  id: string;
  title: string;
  description?: string;
  cost: number;
  keepAfterRedemption: boolean;
  maxRedemptions?: number | null;
  discountPercent?: number | null;
  discountStart?: string | null;
  discountEnd?: string | null;
  availabilityMode: 'ALWAYS' | 'WEEKENDS' | 'DATES' | 'WEEKENDS_OR_DATES';
  availableStartTime?: string | null;
  availableEndTime?: string | null;
  availableDates?: { id?: string; date: string }[];
  effectiveCost?: number;
  availability?: { available: boolean; reason?: string | null; nextAvailableAt?: string | null };
}
export interface Wish { id:string; title:string; description?:string; status:'PENDING'|'APPROVED'|'REJECTED'; user:{id:string;name:string}; }

export interface RewardRedemption {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  reservedPoints: number;
  costSnapshot?: number | null;
  reward: Reward;
  user: { id: string; name: string; points: number };
}

export interface AllowanceSettings { pointsPerTwd?: number | null; monthlyAllowanceLimitTwd?: number | null; timezone: string; }
export interface AllowanceRedemption {
  id: string; amountTwd: number; pointsPerTwdSnapshot: number; reservedPoints: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; createdAt: string;
  user?: { id: string; name: string; points: number };
}

export interface TrophyInput {
  title: string; description: string; tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'STELLAR';
  iconKey: string; isSecret: boolean;
  triggerType: 'MANUAL' | 'TASK_APPROVED_COUNT' | 'POINTS_EARNED' | 'REWARD_APPROVED_COUNT' | 'WISH_APPROVED_COUNT';
  threshold: number; isActive?: boolean;
}
export interface Trophy extends TrophyInput {
  id: string; scope: 'SYSTEM' | 'FAMILY'; familyId?: string | null; progress: number; unlocked: boolean;
  unlock?: { source: 'AUTOMATIC' | 'MANUAL' | 'RETROACTIVE'; unlockedAt: string } | null;
}

export interface MonthlyChildReport {
  user: { id: string; name: string };
  summary: { openingPoints:number; earned:number; rewardSpent:number; allowanceSpent:number; deducted:number; reversed:number; closingPoints:number };
  taskSummary: { approvedCount:number; rejectedCount:number; totalPoints:number; topTasks:string[] };
  challengeSummary: { bonusStars:number; awards:ChallengeAward[] };
  allowanceTwd:number; trophies:Array<{ id:string; trophy:Trophy; unlockedAt:string }>;
  transactions: PointTransaction[];
}
export interface MonthlyReport {
  month:string; timezone:string; family:{id:string;name:string};
  familySummary:{earned:number;spent:number;deducted:number;tasks:number;allowanceTwd:number;trophies:number};
  children:MonthlyChildReport[];
}

export interface TaskGroup { id: string; name: string; sortOrder: number; }

export interface ChallengeInput {
  title:string; taskIds:string[]; childIds:string[]; bonusStars:number;
  customTitle?:string|null; customDescription?:string|null; isActive:boolean;
}
export interface ChallengeAward {
  id:string; challengeId:string; userId:string; localDate:string; title:string;
  bonusStars:number; customTitle:string|null; customDescription:string|null;
  earnedAt:string; fulfilledAt:string|null; user?:{id:string;name:string};
}
export interface ChallengeData {
  localDate:string; children:{id:string;name:string}[];
  settings:(ChallengeInput & {id:string;effectiveDate:string})[];
  progress:(ChallengeInput & {id:string;localDate:string;user:{id:string;name:string};tasks:{id:string;title:string;status:'READY'|'PENDING'|'APPROVED'}[];award:ChallengeAward|null})[];
  awards:ChallengeAward[];
}
