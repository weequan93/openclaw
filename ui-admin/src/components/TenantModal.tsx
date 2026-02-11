import React, { useState, useEffect } from 'react';

export interface TenantFormData {
    id?: string;
    name: string;
    slug: string;
    plan: string;
    status?: string;
    ownerEmail?: string;
    ownerName?: string;
    ownerPassword?: string;
}

interface TenantModalProps {
    isOpen: boolean;
    initialData?: TenantFormData;
    onClose: () => void;
    onSave: (data: TenantFormData) => Promise<void>;
}

export function TenantModal({ isOpen, initialData, onClose, onSave }: TenantModalProps) {
    const [formData, setFormData] = useState<TenantFormData>({
        name: '',
        slug: '',
        plan: 'starter',
        status: 'active',
        ownerEmail: '',
        ownerName: '',
        ownerPassword: ''
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen && initialData) {
            setFormData(initialData);
        } else {
            setFormData({
                name: '',
                slug: '',
                plan: 'starter',
                status: 'active',
                ownerEmail: '',
                ownerName: '',
                ownerPassword: ''
            });
        }
        setError('');
    }, [isOpen, initialData]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await onSave(formData);
            onClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={overlayStyle}>
            <div style={modalStyle}>
                <h3 style={{ marginTop: 0 }}>{initialData ? 'Edit Tenant' : 'New Tenant'}</h3>
                {error && <p style={{ color: 'red', fontSize: '0.9rem' }}>{error}</p>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label style={labelStyle}>Name</label>
                        <input
                            style={inputStyle}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="My Tenant"
                            required
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>Slug</label>
                        <input
                            style={inputStyle}
                            value={formData.slug}
                            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                            placeholder="my-tenant"
                            required
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>Plan</label>
                        <select
                            style={inputStyle}
                            value={formData.plan}
                            onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
                        >
                            <option value="starter">Starter</option>
                            <option value="professional">Professional</option>
                            <option value="enterprise">Enterprise</option>
                        </select>
                    </div>
                    {initialData && (
                        <div>
                            <label style={labelStyle}>Status</label>
                            <select
                                style={inputStyle}
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            >
                                <option value="active">Active</option>
                                <option value="suspended">Suspended</option>
                                <option value="deleted">Deleted</option>
                            </select>
                        </div>
                    )}
                    {!initialData && (
                        <>
                            <div>
                                <label style={labelStyle}>Owner Email</label>
                                <input
                                    style={inputStyle}
                                    value={formData.ownerEmail || ''}
                                    onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
                                    placeholder="owner@company.com"
                                    required
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Owner Name</label>
                                <input
                                    style={inputStyle}
                                    value={formData.ownerName || ''}
                                    onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                                    placeholder="Owner Name"
                                    required
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Owner Password (Optional)</label>
                                <input
                                    style={inputStyle}
                                    type="password"
                                    value={formData.ownerPassword || ''}
                                    onChange={(e) => setFormData({ ...formData, ownerPassword: e.target.value })}
                                    placeholder="Leave blank to generate"
                                />
                            </div>
                        </>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={saving} style={saveBtnStyle}>
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const overlayStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000
};

const modalStyle: React.CSSProperties = {
    backgroundColor: '#242424', padding: '2rem', borderRadius: '8px',
    width: '400px', border: '1px solid #333', boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
};

const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#ccc'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px', borderRadius: '4px',
    border: '1px solid #444', backgroundColor: '#333', color: 'white'
};

const saveBtnStyle: React.CSSProperties = {
    padding: '8px 16px', borderRadius: '4px', border: 'none',
    backgroundColor: '#2563eb', color: 'white', cursor: 'pointer'
};

const cancelBtnStyle: React.CSSProperties = {
    padding: '8px 16px', borderRadius: '4px', border: '1px solid #444',
    backgroundColor: 'transparent', color: '#ccc', cursor: 'pointer'
};
