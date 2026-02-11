import { CSSProperties, useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';
import { TenantFormData, TenantModal } from '../components/TenantModal';

interface Tenant {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    owner_id?: string;
    user_count?: number;
    agent_count?: number;
    session_count?: number;
}

export function TenantsList() {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTenant, setEditingTenant] = useState<TenantFormData | undefined>(undefined);

    const loadTenants = () => {
        setLoading(true);
        adminApi.get<{ tenants: Tenant[] }>('/tenants').then(res => {
            if (res.success && res.data) {
                setTenants(res.data.tenants);
            } else {
                setError(res.error || 'Failed to load tenants');
            }
            setLoading(false);
        });
    };

    useEffect(() => {
        loadTenants();
    }, []);

    const handleCreateClick = () => {
        setEditingTenant(undefined);
        setIsModalOpen(true);
    };

    const handleEditClick = (tenant: Tenant) => {
        setEditingTenant({
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            plan: tenant.plan,
            status: tenant.status
        });
        setIsModalOpen(true);
    };

    const handleSave = async (data: TenantFormData) => {
        if (data.id) {
            // Edit
            const res = await adminApi.patch<{ tenant: Tenant }>(`/tenants/${data.id}`, data);
            if (!res.success) throw new Error(res.error);
        } else {
            // Create
            const res = await adminApi.post<{ tenant: Tenant; ownerPassword?: string }>('/tenants', data);
            if (!res.success) throw new Error(res.error);
            if (res.data?.ownerPassword) {
                alert(`Owner temporary password: ${res.data.ownerPassword}`);
            }
        }
        loadTenants();
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem' }}>Tenants</h2>
                <button style={btnStyle} onClick={handleCreateClick}>+ New Tenant</button>
            </div>
            {loading ? (
                <p>Loading...</p>
            ) : error ? (
                <p style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1rem', borderRadius: '4px', border: '1px solid #7f1d1d' }}>Error: {error}</p>
            ) : tenants.length === 0 ? (
                <p style={{ color: '#888' }}>No tenants found. Create one to get started.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #444' }}>
                            <th style={thStyle}>ID</th>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Slug</th>
                            <th style={thStyle}>Plan</th>
                            <th style={thStyle}>Users</th>
                            <th style={thStyle}>Agents</th>
                            <th style={thStyle}>Sessions</th>
                            <th style={thStyle}>Status</th>
                            <th style={thStyle}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tenants.map(t => (
                            <tr key={t.id} style={{ borderBottom: '1px solid #333' }}>
                                <td style={tdStyle}>{t.id}</td>
                                <td style={tdStyle}>{t.name}</td>
                                <td style={tdStyle}>{t.slug}</td>
                                <td style={tdStyle}>{t.plan}</td>
                                <td style={tdStyle}>{t.user_count ?? 0}</td>
                                <td style={tdStyle}>{t.agent_count ?? 0}</td>
                                <td style={tdStyle}>{t.session_count ?? 0}</td>
                                <td style={tdStyle}>
                                    <span style={{
                                        padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem',
                                        background: t.status === 'active' ? '#1b5e20' : '#b71c1c'
                                    }}>
                                        {t.status}
                                    </span>
                                </td>
                                <td style={tdStyle}>
                                    <button
                                        style={{ ...btnStyle, fontSize: '0.8rem', padding: '4px 8px' }}
                                        onClick={() => handleEditClick(t)}
                                    >
                                        Edit
                                    </button>
                                    <a
                                        href={`/tenants/${t.id}/settings`}
                                        onClick={(e) => { e.preventDefault(); window.location.href = `/tenants/${t.id}/settings`; }}
                                        style={{ ...btnStyle, fontSize: '0.8rem', padding: '4px 8px', marginLeft: '8px', background: '#444' }}
                                    >
                                        Settings
                                    </a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <TenantModal
                isOpen={isModalOpen}
                initialData={editingTenant}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
            />
        </div>
    );
}

const thStyle = { padding: '1rem', color: '#888', fontWeight: 'normal' } as CSSProperties;
const tdStyle = { padding: '1rem' } as CSSProperties;
const btnStyle = {
    background: '#2563eb', color: 'white', border: 'none', padding: '8px 16px',
    borderRadius: '4px', cursor: 'pointer'
} as CSSProperties;
