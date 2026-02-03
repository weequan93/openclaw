/**
 * Message Input Component
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { useChat } from '../../contexts/ChatContext';

export function MessageInput() {
    const { sendMessage, uploadFile, isLoading, activeSession } = useChat();
    const [message, setMessage] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [message]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!message.trim() || isLoading || !activeSession) {
            return;
        }

        const messageToSend = message;
        setMessage('');

        try {
            await sendMessage(messageToSend);
        } catch (error) {
            console.error('Failed to send message:', error);
            setMessage(messageToSend); // Restore message on error
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeSession) {
            return;
        }

        const maxSize = parseInt(import.meta.env.VITE_MAX_FILE_SIZE || '10485760');
        if (file.size > maxSize) {
            alert(`File size must be less than ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
            return;
        }

        setIsUploading(true);
        try {
            await uploadFile(file);
        } catch (error) {
            console.error('Failed to upload file:', error);
            alert('Failed to upload file. Please try again.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const disabled = isLoading || isUploading || !activeSession;

    return (
        <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white p-4">
            <div className="flex items-end gap-2">
                {/* File Upload Button */}
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Attach file"
                >
                    <Paperclip className="w-5 h-5" />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt"
                />

                {/* Message Textarea */}
                <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        !activeSession
                            ? 'Select an agent to start chatting...'
                            : 'Type a message... (Shift+Enter for new line)'
                    }
                    disabled={disabled}
                    className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed max-h-32"
                    rows={1}
                />

                {/* Send Button */}
                <button
                    type="submit"
                    disabled={disabled || !message.trim()}
                    className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send className="w-5 h-5" />
                </button>
            </div>

            {/* Character Count */}
            {message.length > 0 && (
                <div className="text-xs text-gray-500 mt-1 text-right">
                    {message.length} characters
                </div>
            )}
        </form>
    );
}
