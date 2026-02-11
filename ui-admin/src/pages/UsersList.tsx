import { CSSProperties, useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';
import { adminMode } from '../admin-config';

interface User {
    id: string;
    email: string;
    role: string;
    tenantId: string;
    fullName?: string;
}

export function UsersList() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tempPassword, setTempPassword] = useState<string | null>(null);
    const [form, setForm] = useState({ email: '', fullName: '', role: 'viewer', password: '' });

    useEffect(() => {
        adminApi.get<{ users: User[] }>('/users').then(res => {
            if (res.success && res.data) {
                setUsers(res.data.users);
            } else if (!res.success) {
                setError(res.error || 'Failed to load users');
            }
            setLoading(false);
        });
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setTempPassword(null);
        const res = await adminApi.post<{ user: User; tempPassword?: string }>('/users', form);
        if (!res.success) {
            setError(res.error || 'Failed to create user');
            return;
        }
        if (res.data?.tempPassword) {
            setTempPassword(res.data.tempPassword);
        }
        setForm({ email: '', fullName: '', role: 'viewer', password: '' });
        adminApi.get<{ users: User[] }>('/users').then(r => {
            if (r.success && r.data) {
                setUsers(r.data.users);
            }
        });
    };

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Users</h2>
            {error && <p style={{ color: '#ef4444' }}>{error}</p>}

            {adminMode === 'tenant' && (
                <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
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
                    <select
                        style={inputStyle}
                        value={form.role}
                        onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                        <option value="tenant_admin">Tenant Admin</option>
                        <option value="admin">Admin</option>
                        <option value="developer">Developer</option>
                        <option value="operator">Operator</option>
                        <option value="viewer">Viewer</option>
                    </select>
                    <input
                        style={inputStyle}
                        type="password"
                        placeholder="Password (optional)"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                    <button type="submit" style={btnStyle}>Add User</button>
                </form>
            )}

            {tempPassword && (
                <div style={{ marginBottom: '1rem', color: '#d1d5db' }}>
                    Temp password: <code style={{ background: '#111', padding: '2px 6px', borderRadius: '4px' }}>{tempPassword}</code>
                </div>
            )}

            {loading ? (
                <p>Loading...</p>
            ) : users.length === 0 ? (
                <p style={{ color: '#888' }}>No users found.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #444' }}>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Email</th>
                            <th style={thStyle}>Role</th>
                            <th style={thStyle}>Tenant ID</th>
                            <th style={thStyle}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.id} style={{ borderBottom: '1px solid #333' }}>
                                <td style={tdStyle}>{u.fullName || '—'}</td>
                                <td style={tdStyle}>{u.email}</td>
                                <td style={tdStyle}>{u.role}</td>
                                <td style={tdStyle}>{u.tenantId || '—'}</td>
                                <td style={tdStyle}>
                                    <button style={{ ...btnStyle, fontSize: '0.8rem', padding: '4px 8px' }}>Manage</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

const thStyle = { padding: '1rem', color: '#888', fontWeight: 'normal' } as CSSProperties;
const tdStyle = { padding: '1rem' } as CSSProperties;
const btnStyle = { background: '#2563eb', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' } as CSSProperties;
const inputStyle: CSSProperties = {
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #444',
    background: '#333',
    color: '#fff'
};
