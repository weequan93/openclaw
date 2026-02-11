import React, { useState } from 'react';
import { adminApi } from '../services/admin-api';

export function TenantDetail() {
    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        plan: 'Pro'
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await adminApi.post('/tenants', formData);
        if (res.success) {
            alert('Tenant created!');
        } else {
            alert('Error: ' + res.error);
        }
    };

    return (
        <div style={{ maxWidth: '600px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Create / Edit Tenant</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                    <label style={labelStyle}>Tenant Name</label>
                    <input name="name" style={inputStyle} value={formData.name} onChange={handleChange} required />
                </div>
                <div>
                    <label style={labelStyle}>URL Slug</label>
                    <input name="slug" style={inputStyle} value={formData.slug} onChange={handleChange} required />
                </div>
                <div>
                    <label style={labelStyle}>Plan</label>
                    <select name="plan" style={inputStyle} value={formData.plan} onChange={handleChange}>
                        <option value="Pro">Pro</option>
                        <option value="Enterprise">Enterprise</option>
                    </select>
                </div>
                <button type="submit" style={btnStyle}>Save Tenant</button>
            </form>
        </div>
    );
}

const labelStyle = { display: 'block', marginBottom: '4px', color: '#ccc' } as React.CSSProperties;
const inputStyle = { width: '100%', padding: '8px', background: '#222', border: '1px solid #444', color: 'white', borderRadius: '4px' } as React.CSSProperties;
const btnStyle = { padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' } as React.CSSProperties;
