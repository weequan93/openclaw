import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Users, Building, Key, LayoutDashboard, ScrollText, Shield } from 'lucide-react';
import { adminApi } from '../services/admin-api';
import { adminMode } from '../admin-config';

export function Layout() {
    const navigate = useNavigate();
    const [token, setToken] = React.useState(adminApi.getToken());
    const [tenant, setTenant] = React.useState<{ name: string; slug: string } | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }
        adminApi.me<{ user: { email: string; role: string } }>().then(res => {
            if (res.success && res.data?.user) {
                if (adminMode === 'tenant') {
                    adminApi.get<{ tenant: { name: string; slug: string } }>('/tenant').then(tenantRes => {
                        if (tenantRes.success && tenantRes.data?.tenant) {
                            setTenant(tenantRes.data.tenant);
                        }
                    });
                }
            } else {
                adminApi.clearToken();
                setToken('');
            }
            setLoading(false);
        });
    }, [token]);

    if (loading) {
        return (
            <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#fff' }}>
                <div>Loading...</div>
            </div>
        );
    }

    if (!token) {
        return (
            <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#fff' }}>
                <div style={{ background: '#222', padding: '2rem', borderRadius: '8px', border: '1px solid #333', marginTop: '-10%', width: '320px' }}>
                    <h2>{adminMode === 'tenant' ? 'Tenant Admin' : 'Platform Admin'}</h2>
                    <p style={{ color: '#aaa', marginBottom: '1rem' }}>
                        Sign in with your email and password.
                    </p>
                    {error && <div style={{ ...errorStyle, marginBottom: '1rem' }}>{error}</div>}
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value.trim();
                        const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
                        const tenantSlug = adminMode === 'tenant'
                            ? (e.currentTarget.elements.namedItem('tenantSlug') as HTMLInputElement).value.trim()
                            : '';
                        setError('');
                        const payload: Record<string, string> = { email, password };
                        if (adminMode === 'tenant') {
                            payload.tenantSlug = tenantSlug;
                        }
                        adminApi.login<{ token: string }>(payload)
                            .then(res => {
                                if (res.success && res.data?.token) {
                                    adminApi.setToken(res.data.token);
                                    setToken(res.data.token);
                                    navigate('/');
                                } else {
                                    setError(res.error || 'Login failed');
                                }
                            });
                    }}>
                        {adminMode === 'tenant' && (
                            <input
                                name="tenantSlug"
                                type="text"
                                placeholder="Tenant slug"
                                style={inputStyle}
                            />
                        )}
                        <input
                            name="email"
                            type="email"
                            placeholder="Email"
                            style={inputStyle}
                        />
                        <input
                            name="password"
                            type="password"
                            placeholder="Password"
                            style={inputStyle}
                        />
                        <button type="submit" style={{ width: '100%', padding: '8px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                            Sign In
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', minHeight: '100vh', textAlign: 'left' }}>
            <aside style={{ width: '250px', backgroundColor: '#1a1a1a', padding: '1rem', borderRight: '1px solid #333' }}>
                <h2 style={{ marginBottom: '0.5rem', fontSize: '1.2rem', fontWeight: 'bold' }}>
                    {adminMode === 'tenant' ? 'Tenant Admin' : 'Platform Admin'}
                </h2>
                {tenant && adminMode === 'tenant' && (
                    <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                        {tenant.name} ({tenant.slug})
                    </div>
                )}
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <NavLink to="/" end style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><LayoutDashboard size={18} /> Dashboard</NavLink>
                    {adminMode === 'platform' && (
                        <>
                            <NavLink to="/tenants" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><Building size={18} /> Tenants</NavLink>
                            <NavLink to="/owners" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><Users size={18} /> Tenant Owners</NavLink>
                            <NavLink to="/platform-admins" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><Shield size={18} /> Platform Admins</NavLink>
                        </>
                    )}
                    {adminMode === 'tenant' && (
                        <>
                            <NavLink to="/users" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><Users size={18} /> Users</NavLink>
                            <NavLink to="/settings" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><Key size={18} /> Settings</NavLink>
                        </>
                    )}
                    <NavLink to="/logs" style={({ isActive }) => ({ ...navLinkStyle, background: isActive ? '#333' : 'transparent', color: isActive ? '#fff' : '#ccc' })}><ScrollText size={18} /> Logs</NavLink>
                    <button onClick={() => { adminApi.clearToken(); setToken(''); setTenant(null); }} style={{ ...navLinkStyle, background: 'none', border: 'none', cursor: 'pointer', marginTop: 'auto', color: '#f87171' }}>
                        Logout
                    </button>
                </nav>
            </aside>
            <main style={{ flex: 1, padding: '2rem' }}>
                <Outlet />
            </main>
        </div>
    );
}

const navLinkStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#ccc',
    textDecoration: 'none',
    padding: '10px',
    borderRadius: '6px',
    transition: 'background 0.2s',
} as React.CSSProperties;

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px',
    marginBottom: '0.75rem',
    borderRadius: '4px',
    border: '1px solid #444',
    background: '#333',
    color: '#fff'
};

const errorStyle: React.CSSProperties = {
    color: '#ef4444',
    background: 'rgba(239,68,68,0.1)',
    padding: '0.75rem',
    borderRadius: '4px',
    border: '1px solid #7f1d1d',
};
