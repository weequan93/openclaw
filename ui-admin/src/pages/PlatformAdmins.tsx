import { CSSProperties, useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';

interface PlatformAdmin {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    tenant_id: string;
    revoked?: boolean;
    revoked_at?: string | null;
}

export function PlatformAdmins() {
    const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ email: '', fullName: '', password: '' });
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const loadAdmins = () => {
        setLoading(true);
        adminApi.get<{ admins: PlatformAdmin[] }>('/platform-admins').then(res => {
            if (res.success && res.data) {
                setAdmins(res.data.admins);
            } else if (!res.success) {
                setError(res.error || 'Failed to load admins');
            }
            setLoading(false);
        });
    };

    useEffect(() => {
        loadAdmins();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const res = await adminApi.post('/platform-admins', form);
        if (!res.success) {
            setError(res.error || 'Failed to create admin');
            return;
        }
        setForm({ email: '', fullName: '', password: '' });
        loadAdmins();
    };

    const handleRevoke = async (admin: PlatformAdmin) => {
        const ok = window.confirm(`Revoke platform admin access for ${admin.email}?`);
        if (!ok) {
            return;
        }
        setError('');
        setRevokingId(admin.id);
        const res = await adminApi.post(`/platform-admins/${admin.id}/revoke`, {});
        if (!res.success) {
            setError(res.error || 'Failed to revoke admin access');
            setRevokingId(null);
            return;
        }
        setRevokingId(null);
        loadAdmins();
    };

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Platform Admins</h2>
            {error && <p style={{ color: '#ef4444' }}>{error}</p>}

            <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                <input
                    style={inputStyle}
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <input
                    style={inputStyle}
                    placeholder="Full name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
                <input
                    style={inputStyle}
                    type="password"
                    placeholder="Password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button type="submit" style={btnStyle}>Add Admin</button>
            </form>

            {loading ? (
                <p>Loading...</p>
            ) : admins.length === 0 ? (
                <p style={{ color: '#888' }}>No platform admins found.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #444' }}>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Email</th>
                            <th style={thStyle}>Role</th>
                            <th style={thStyle}>Status</th>
                            <th style={thStyle}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {admins.map(a => (
                            <tr key={a.id} style={{ borderBottom: '1px solid #333' }}>
                                <td style={tdStyle}>{a.full_name || '—'}</td>
                                <td style={tdStyle}>{a.email}</td>
                                <td style={tdStyle}>{a.role}</td>
                                <td style={tdStyle}>
                                    {a.revoked ? (
                                        <span style={statusRevokedStyle}>Revoked</span>
                                    ) : (
                                        <span style={statusActiveStyle}>Active</span>
                                    )}
                                </td>
                                <td style={tdStyle}>
                                    <button
                                        type="button"
                                        style={revokeBtnStyle}
                                        onClick={() => handleRevoke(a)}
                                        disabled={revokingId === a.id || a.revoked}
                                    >
                                        {a.revoked ? 'Revoked' : (revokingId === a.id ? 'Revoking…' : 'Revoke')}
                                    </button>
                                </td>
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

const revokeBtnStyle: CSSProperties = {
    background: '#dc2626',
    color: 'white',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer'
};

const statusActiveStyle: CSSProperties = {
    color: '#34d399',
    fontWeight: 600
};

const statusRevokedStyle: CSSProperties = {
    color: '#f87171',
    fontWeight: 600
};

const thStyle = { padding: '0.75rem', color: '#888', fontWeight: 'normal' } as CSSProperties;
const tdStyle = { padding: '0.75rem' } as CSSProperties;
