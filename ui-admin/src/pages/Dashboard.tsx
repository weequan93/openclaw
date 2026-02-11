import { useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';
import { adminMode } from '../admin-config';

interface StatsResponse {
    totals: {
        tenants?: number;
        users: number;
        agents: number;
        sessions: number;
    };
}

interface TenantSummary {
    id: string;
    name: string;
    slug: string;
    user_count: number;
    agent_count: number;
    session_count: number;
    status: string;
}

export function Dashboard() {
    const [stats, setStats] = useState<StatsResponse>({
        totals: {
            tenants: 0,
            users: 0,
            agents: 0,
            sessions: 0,
        }
    });
    const [tenants, setTenants] = useState<TenantSummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        adminApi.get<StatsResponse>('/stats').then(res => {
            if (res.success && res.data) {
                setStats(res.data);
            }
            setLoading(false);
        });
        if (adminMode === 'platform') {
            adminApi.get<{ tenants: TenantSummary[] }>('/tenants?limit=8').then(res => {
                if (res.success && res.data) {
                    setTenants(res.data.tenants);
                }
            });
        }
    }, []);

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Dashboard</h2>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        {adminMode === 'platform' && <Card title="Total Tenants" value={String(stats.totals.tenants ?? 0)} />}
                        <Card title="Active Users" value={String(stats.totals.users)} />
                        <Card title="Agents" value={String(stats.totals.agents)} />
                        <Card title="Sessions" value={String(stats.totals.sessions)} />
                    </div>
                    {adminMode === 'platform' && tenants.length > 0 && (
                        <div style={{ marginTop: '2rem' }}>
                            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', color: '#ccc' }}>Tenants (summary)</h3>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #444' }}>
                                        <th style={thStyle}>Name</th>
                                        <th style={thStyle}>Slug</th>
                                        <th style={thStyle}>Users</th>
                                        <th style={thStyle}>Agents</th>
                                        <th style={thStyle}>Sessions</th>
                                        <th style={thStyle}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tenants.map(t => (
                                        <tr key={t.id} style={{ borderBottom: '1px solid #333' }}>
                                            <td style={tdStyle}>{t.name}</td>
                                            <td style={tdStyle}>{t.slug}</td>
                                            <td style={tdStyle}>{t.user_count}</td>
                                            <td style={tdStyle}>{t.agent_count}</td>
                                            <td style={tdStyle}>{t.session_count}</td>
                                            <td style={tdStyle}>{t.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function Card({ title, value }: { title: string, value: string }) {
    return (
        <div style={{ background: '#333', padding: '1.5rem', borderRadius: '8px' }}>
            <h3 style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{title}</h3>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{value}</div>
        </div>
    );
}

const thStyle = { padding: '0.75rem', color: '#888', fontWeight: 'normal' } as const;
const tdStyle = { padding: '0.75rem' } as const;
