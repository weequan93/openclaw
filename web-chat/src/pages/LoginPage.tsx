/**
 * Login Page
 */

import React from 'react';
import { LoginForm } from '../components/Auth/LoginForm';

export function LoginPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-gray-100 p-4">
            <LoginForm />
        </div>
    );
}
