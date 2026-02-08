import type { NextFunction, Request, Response } from "express";

export type UserRole = "admin" | "finance" | "sales" | "auditor";
const validRoles = new Set<UserRole>(["admin", "finance", "sales", "auditor"]);

export function authContext(req: Request, _res: Response, next: NextFunction) {
  const roleHeader = String(req.header("x-user-role") || "").trim().toLowerCase();
  const role: UserRole = validRoles.has(roleHeader as UserRole) ? (roleHeader as UserRole) : "admin";
  const userId = String(req.header("x-user-id") || "system").trim() || "system";
  req.auth = { role, userId };
  next();
}

export function requireRoles(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const currentRole = req.auth?.role ?? "admin";
    if (!roles.includes(currentRole)) {
      res.status(403).json({
        message: "Forbidden: insufficient role",
        requiredRoles: roles,
        currentRole
      });
      return;
    }
    next();
  };
}
