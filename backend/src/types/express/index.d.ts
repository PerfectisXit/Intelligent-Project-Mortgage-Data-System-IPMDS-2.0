import type { UserRole } from "../../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        role: UserRole;
        userId: string;
      };
    }
  }
}

export {};
