import { CSSProperties, useEffect, useState } from 'react';
import { adminApi } from '../services/admin-api';

interface OwnerRow {
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    user_id: string | null;
    email: string | null;
    full_name: string | null;
}

export function OwnersList() {
    const [owners, setOwners] = useState<OwnerRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        adminApi.get<{ owners: OwnerRow[] }>('/owners').then(res => {
            if (res.success && res.data) {
                setOwners(res.data.owners);
            }
            setLoading(false);
        });
    }, []);

    return (
        <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Tenant Owners</h2>
            {loading ? (
                <p>Loading...</p>
            ) : owners.length === 0 ? (
                <p style={{ color: '#888' }}>No tenants found.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #444' }}>
                            <th style={thStyle}>Tenant</th>
                            <th style={thStyle}>Slug</th>
                            <th style={thStyle}>Owner</th>
                            <th style={thStyle}>Email</th>
                        </tr>
                    </thead>
                    <tbody>
                        {owners.map((row) => (
                            <tr key={row.tenant_id} style={{ borderBottom: '1px solid #333' }}>
                                <td style={tdStyle}>{row.tenant_name}</td>
                                <td style={tdStyle}>{row.tenant_slug}</td>
                                <td style={tdStyle}>{row.full_name || '—'}</td>
                                <td style={tdStyle}>{row.email || '—'}</td>
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
