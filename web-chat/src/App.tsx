/**
 * Root App Component
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';

export function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <ChatProvider>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route
                            path="/chat"
                            element={
                                <ProtectedRoute>
                                    <ChatPage />
                                </ProtectedRoute>
                            }
                        />
                        <Route path="/" element={<Navigate to="/chat" replace />} />
                        <Route path="*" element={<Navigate to="/chat" replace />} />
                    </Routes>
                </ChatProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}
