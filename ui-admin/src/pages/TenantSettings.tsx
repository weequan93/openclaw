import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../services/admin-api';
import { adminMode } from '../admin-config';

interface Tenant {
    id: string;
    name: string;
    slug: string;
    settings?: {
        sso?: {
            enabled: boolean;
            provider: 'saml' | 'oauth2';
            entryPoint?: string;
            issuer?: string;
            cert?: string;
        }
    }
}

export function TenantSettings() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const [ssoConfig, setSsoConfig] = useState({
        enabled: false,
        provider: 'saml',
        entryPoint: '',
        issuer: 'openclaw',
        cert: ''
    });

    useEffect(() => {
        setLoading(true);
        const target = adminMode === 'tenant' ? '/tenant' : `/tenants/${id}`;
        if (adminMode === 'platform' && !id) {
            setLoading(false);
            setError('Missing tenant id');
            return;
        }
        adminApi.get<{ tenant: Tenant }>(target).then(res => {
            if (res.success && res.data) {
                setTenant(res.data.tenant);
                if (res.data.tenant.settings?.sso) {
                    setSsoConfig({
                        enabled: res.data.tenant.settings.sso.enabled ?? false,
                        provider: res.data.tenant.settings.sso.provider as any ?? 'saml',
                        entryPoint: res.data.tenant.settings.sso.entryPoint ?? '',
                        issuer: res.data.tenant.settings.sso.issuer ?? 'openclaw',
                        cert: res.data.tenant.settings.sso.cert ?? ''
                    });
                }
            } else {
                setError(res.error || 'Failed to load tenant');
            }
            setLoading(false);
        });
    }, [id]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tenant) return;

        setSaving(true);
        setError('');

        const updatedSettings = {
            ...(tenant.settings || {}),
            sso: ssoConfig
        };

        const target = adminMode === 'tenant' ? '/tenant' : `/tenants/${tenant.id}`;
        const res = await adminApi.patch<{ tenant: Tenant }>(target, {
            settings: updatedSettings
        });

        if (res.success) {
            alert('Settings saved successfully');
            setTenant(res.data!.tenant);
        } else {
            setError(res.error || 'Failed to save settings');
        }
        setSaving(false);
    };

    if (loading) return <div>Loading...</div>;
    if (!tenant) return <div>Tenant not found</div>;

    return (
        <div style={{ maxWidth: '800px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                {adminMode === 'platform' && (
                    <button onClick={() => navigate('/tenants')} style={backBtnStyle}>← Back</button>
                )}
                <h2 style={{ margin: 0 }}>Settings: {tenant.name}</h2>
            </div>

            {error && <div style={errorStyle}>{error}</div>}

            <div style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Single Sign-On (SSO)</h3>
                <p style={{ color: '#888', marginBottom: '1.5rem' }}>
                    Configure enterprise SSO for this tenant. Users can log in via <code>/auth/login/sso?tenant={tenant.slug}</code>.
                </p>

                <form onSubmit={handleSave}>
                    <div style={formGroupStyle}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={ssoConfig.enabled}
                                onChange={e => setSsoConfig({ ...ssoConfig, enabled: e.target.checked })}
                            />
                            <strong>Enable SSO</strong>
                        </label>
                    </div>

                    {ssoConfig.enabled && (
                        <>
                            <div style={formGroupStyle}>
                                <label style={labelStyle}>Provider Type</label>
                                <select
                                    style={inputStyle}
                                    value={ssoConfig.provider}
                                    onChange={e => setSsoConfig({ ...ssoConfig, provider: e.target.value as any })}
                                >
                                    <option value="saml">SAML 2.0</option>
                                    <option value="oauth2" disabled>OAuth2 (Coming Soon)</option>
                                </select>
                            </div>

                            <div style={formGroupStyle}>
                                <label style={labelStyle}>Identity Provider Entry Point (SSO URL)</label>
                                <input
                                    style={inputStyle}
                                    value={ssoConfig.entryPoint}
                                    onChange={e => setSsoConfig({ ...ssoConfig, entryPoint: e.target.value })}
                                    placeholder="https://idp.example.com/sso/saml"
                                />
                            </div>

                            <div style={formGroupStyle}>
                                <label style={labelStyle}>Issuer (Entity ID)</label>
                                <input
                                    style={inputStyle}
                                    value={ssoConfig.issuer}
                                    onChange={e => setSsoConfig({ ...ssoConfig, issuer: e.target.value })}
                                    placeholder="openclaw"
                                />
                            </div>

                            <div style={formGroupStyle}>
                                <label style={labelStyle}>X.509 Certificate</label>
                                <textarea
                                    style={{ ...inputStyle, height: '150px', fontFamily: 'monospace' }}
                                    value={ssoConfig.cert}
                                    onChange={e => setSsoConfig({ ...ssoConfig, cert: e.target.value })}
                                    placeholder="-----BEGIN CERTIFICATE-----..."
                                />
                                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                                    Paste the raw certificate text from your Identity Provider.
                                </div>
                            </div>

                            <div style={{ background: '#333', padding: '1rem', borderRadius: '4px', marginTop: '1rem' }}>
                                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#ccc' }}>Configuration Info for IdP</h4>
                                <div style={infoRowStyle}>
                                    <span>Single Sign-On URL (ACS):</span>
                                    <code style={codeStyle}>{window.location.protocol}//{window.location.host}/auth/saml/callback/{tenant.slug}</code>
                                </div>
                                <div style={infoRowStyle}>
                                    <span>Audience URI (SP Entity ID):</span>
                                    <code style={codeStyle}>{ssoConfig.issuer}</code>
                                </div>
                            </div>
                        </>
                    )}

                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="submit" disabled={saving} style={saveBtnStyle}>
                            {saving ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const cardStyle: React.CSSProperties = {
    background: '#1e1e1e', padding: '2rem', borderRadius: '8px', border: '1px solid #333'
};

const formGroupStyle: React.CSSProperties = { marginBottom: '1.5rem' };

const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '0.9rem'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', background: '#252525', border: '1px solid #444',
    color: 'white', borderRadius: '4px', boxSizing: 'border-box'
};

const backBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1rem'
};

const saveBtnStyle: React.CSSProperties = {
    background: '#2563eb', color: 'white', border: 'none', padding: '10px 20px',
    borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
};

const errorStyle: React.CSSProperties = {
    color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1rem',
    borderRadius: '4px', border: '1px solid #7f1d1d', marginBottom: '1rem'
};

const infoRowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.85rem'
};

const codeStyle: React.CSSProperties = {
    background: '#111', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', color: '#888'
};
