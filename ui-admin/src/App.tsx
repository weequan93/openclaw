import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { TenantsList } from './pages/TenantsList'
import { TenantSettings } from './pages/TenantSettings'
import { UsersList } from './pages/UsersList'
import { OwnersList } from './pages/OwnersList'
import { PlatformAdmins } from './pages/PlatformAdmins'
import { AuditLogs } from './pages/AuditLogs'
import { adminMode } from './admin-config'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    {adminMode === 'platform' && (
                        <>
                            <Route path="tenants" element={<TenantsList />} />
                            <Route path="tenants/:id/settings" element={<TenantSettings />} />
                            <Route path="owners" element={<OwnersList />} />
                            <Route path="platform-admins" element={<PlatformAdmins />} />
                        </>
                    )}
                    {adminMode === 'tenant' && (
                        <>
                            <Route path="users" element={<UsersList />} />
                            <Route path="settings" element={<TenantSettings />} />
                        </>
                    )}
                    <Route path="logs" element={<AuditLogs />} />
                </Route>
            </Routes>
        </BrowserRouter>
    )
}

export default App
