/**
 * PostgreSQL Connection Pool
 * 
 * Manages database connections for OpenClaw multi-tenant deployment.
 * Provides connection pooling, health checks, and graceful shutdown.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';

export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    maxConnections?: number;
    idleTimeoutMs?: number;
    connectionTimeoutMs?: number;
}

export class DatabasePool {
    private pool: Pool;
    private isShuttingDown = false;

    constructor(config: DatabaseConfig) {
        const poolConfig: PoolConfig = {
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            max: config.maxConnections || 20,
            idleTimeoutMillis: config.idleTimeoutMs || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMs || 5000,

            // Connection lifecycle hooks
            application_name: 'openclaw-gateway',
        };

        this.pool = new Pool(poolConfig);

        // Error handling
        this.pool.on('error', (err, client) => {
            console.error('Unexpected error on idle client', err);
        });

        this.pool.on('connect', (client) => {
            console.log('New database connection established');
        });

        this.pool.on('remove', (client) => {
            console.log('Database connection removed from pool');
        });
    }

    /**
     * Get a client from the pool
     */
    async getClient(): Promise<PoolClient> {
        if (this.isShuttingDown) {
            throw new Error('Database pool is shutting down');
        }
        return this.pool.connect();
    }

    /**
     * Execute a query with automatic client management
     */
    async query<T = any>(text: string, params?: any[]): Promise<T[]> {
        const client = await this.getClient();
        try {
            const result = await client.query(text, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Execute a transaction
     */
    async transaction<T>(
        callback: (client: PoolClient) => Promise<T>
    ): Promise<T> {
        const client = await this.getClient();

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
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            const result = await this.query('SELECT 1 as health');
            return result.length > 0 && result[0].health === 1;
        } catch (error) {
            console.error('Database health check failed:', error);
            return false;
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount,
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        console.log('Shutting down database pool...');

        try {
            await this.pool.end();
            console.log('Database pool shut down successfully');
        } catch (error) {
            console.error('Error during database pool shutdown:', error);
            throw error;
        }
    }
}

/**
 * Singleton pool instance
 */
let poolInstance: DatabasePool | null = null;

export function createDatabasePool(config: DatabaseConfig): DatabasePool {
    if (poolInstance) {
        throw new Error('Database pool already initialized');
    }

    poolInstance = new DatabasePool(config);
    return poolInstance;
}

export function getDatabasePool(): DatabasePool {
    if (!poolInstance) {
        throw new Error('Database pool not initialized. Call createDatabasePool() first.');
    }

    return poolInstance;
}

/**
 * Load configuration from environment
 */
export function getDatabaseConfigFromEnv(): DatabaseConfig {
    return {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'openclaw',
        user: process.env.POSTGRES_USER || 'openclaw',
        password: process.env.POSTGRES_PASSWORD || '',
        maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20', 10),
        idleTimeoutMs: parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || '30000', 10),
        connectionTimeoutMs: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || '5000', 10),
    };
}
