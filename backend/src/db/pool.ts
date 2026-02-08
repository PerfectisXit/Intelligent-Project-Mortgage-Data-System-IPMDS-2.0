import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = env.databaseUrl
  ? new Pool({ connectionString: env.databaseUrl })
  : null;
