/**
 * Chat Page
 */

import React from 'react';
import { AppLayout } from '../components/Layout/AppLayout';
import { ChatWindow } from '../components/Chat/ChatWindow';
import { MessageInput } from '../components/Chat/MessageInput';

export function ChatPage() {
    return (
        <AppLayout>
            <ChatWindow />
            <MessageInput />
        </AppLayout>
    );
}
