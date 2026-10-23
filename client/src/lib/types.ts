export interface Department {
  id: string;
  name: string;
}

export interface WorkCenter {
  id: string;
  name: string;
  timezone: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  workCenterId: string | null;
  workCenterName: string | null;
  managerId: string | null;
  managerName: string | null;
  corporateEmail: string | null;
  phone: string | null;
  employmentStatus: string;
  hireDate: string;
  updatedAt: string;
}

export interface TaskEvent {
  type: string;
  detail: Record<string, unknown>;
  actorEmail: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  departmentId: string;
  departmentName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  events?: TaskEvent[];
}

export interface RoleAssignment {
  role: string;
  scope: "company" | "department";
  departmentId: string | null;
}

export interface UserAccount {
  id: string;
  email: string;
  status: string;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
  roles: RoleAssignment[];
}

export interface Invitation {
  token: string;
  expiresAt: string;
}

export interface AuditItem {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  createdAt: string;
  actorEmail: string | null;
}

export interface DashboardData {
  tasksByStatus: Record<string, number>;
  overdueTasks: number;
  myOpenTasks: number;
  activeEmployees: number | null;
  today: string;
}
