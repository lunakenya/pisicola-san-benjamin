// src/lib/db.ts
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // puedes añadir más opciones si quieres (max, idleTimeoutMillis, ...)
});

export default pool;
