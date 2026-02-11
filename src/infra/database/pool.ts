import { Pool, PoolClient, PoolConfig } from 'pg';

/**
 * PostgreSQL connection pool for OpenClaw Enterprise
 * Provides connection pooling with automatic reconnection and health monitoring
 */

const poolConfig: PoolConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'openclaw',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD,
    max: parseInt(process.env.POSTGRES_POOL_MAX || '20', 10),
    min: parseInt(process.env.POSTGRES_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECT_TIMEOUT || '10000', 10),
    // Enable SSL in production
    ssl: process.env.NODE_ENV === 'production' && process.env.POSTGRES_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
};

// Create the connection pool
export const pool = new Pool(poolConfig);

// Error handling
pool.on('error', (err: Error) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

pool.on('connect', () => {
    console.log('New client connected to PostgreSQL');
});

pool.on('remove', () => {
    console.log('Client removed from pool');
});

/**
 * Execute a query with automatic connection management
 */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Executed query', { text, duration, rows: result.rowCount });
        return result.rows;
    } catch (error) {
        console.error('Query error', { text, error });
        throw error;
    }
}

/**
 * Get a client from the pool for transaction management
 */
export async function getClient(): Promise<PoolClient> {
    return await pool.connect();
}

/**
 * Execute a function within a transaction
 */
export async function transaction<T>(
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Check database connection health
 */
export async function healthCheck(): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
}> {
    const start = Date.now();
    try {
        await pool.query('SELECT 1');
        const latency = Date.now() - start;
        return { healthy: true, latency };
    } catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Close all connections in the pool
 */
export async function close(): Promise<void> {
    await pool.end();
    console.log('Database pool closed');
}

// Export pool for direct access if needed
export default pool;
