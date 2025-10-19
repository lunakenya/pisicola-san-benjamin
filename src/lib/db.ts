import { Pool, QueryResult } from 'pg'; // Importamos también QueryResult para el tipado

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // puedes añadir más opciones si quieres (max, idleTimeoutMillis, ...)
});

// 1. Exportamos la función 'query' que usa el objeto 'pool'
export const query = (text: string, params?: any[]): Promise<QueryResult<any>> => {
    // 2. Ejecutamos la consulta usando el pool
    return pool.query(text, params);
};

// Mantenemos la exportación por defecto del pool por si la necesitas en otro lugar
export default pool;