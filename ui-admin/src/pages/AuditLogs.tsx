import { CSSProperties, useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';
import { adminMode } from '../admin-config';

interface AuditLog {
    id: string;
    tenant_id: string;
    user_id: string | null;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
}

export function AuditLogs() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [tenantId, setTenantId] = useState('');

    const loadLogs = () => {
        setLoading(true);
        const query = adminMode === 'platform' && tenantId
            ? `/audit-logs?tenantId=${encodeURIComponent(tenantId)}`
            : '/audit-logs';
        adminApi.get<{ logs: AuditLog[] }>(query).then(res => {
            if (res.success && res.data) {
                setLogs(res.data.logs);
            }
            setLoading(false);
        });
    };

    useEffect(() => {
        loadLogs();
    }, []);

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Audit Logs</h2>
            {adminMode === 'platform' && (
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <input
                        style={inputStyle}
                        placeholder="Filter by tenant ID"
                        value={tenantId}
                        onChange={(e) => setTenantId(e.target.value)}
                    />
                    <button style={btnStyle} onClick={loadLogs}>Apply</button>
                </div>
            )}
            {loading ? (
                <p>Loading...</p>
            ) : logs.length === 0 ? (
                <p style={{ color: '#888' }}>No logs found.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #444' }}>
                            <th style={thStyle}>Time</th>
                            <th style={thStyle}>Tenant</th>
                            <th style={thStyle}>User</th>
                            <th style={thStyle}>Action</th>
                            <th style={thStyle}>Resource</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map(log => (
                            <tr key={log.id} style={{ borderBottom: '1px solid #333' }}>
                                <td style={tdStyle}>{new Date(log.created_at).toLocaleString()}</td>
                                <td style={tdStyle}>{log.tenant_id}</td>
                                <td style={tdStyle}>{log.user_id || '—'}</td>
                                <td style={tdStyle}>{log.action}</td>
                                <td style={tdStyle}>{log.resource_type || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

const inputStyle: CSSProperties = {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #444',
    background: '#333',
    color: '#fff'
};

const btnStyle: CSSProperties = {
    background: '#2563eb',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer'
};

const thStyle = { padding: '0.75rem', color: '#888', fontWeight: 'normal' } as CSSProperties;
const tdStyle = { padding: '0.75rem' } as CSSProperties;
