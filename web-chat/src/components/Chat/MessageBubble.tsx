/**
 * Message Bubble Component
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { formatDistanceToNow } from 'date-fns';
import { Copy, Check } from 'lucide-react';
import type { Message } from '../../types';
import { clsx } from 'clsx';

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const [copied, setCopied] = React.useState(false);
    const isUser = message.role === 'user';

    const handleCopy = () => {
        const textContent = message.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as any).text)
            .join('\n');

        navigator.clipboard.writeText(textContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div
            className={clsx(
                'flex gap-3 animate-fade-in',
                isUser ? 'flex-row-reverse' : 'flex-row'
            )}
        >
            {/* Avatar */}
            <div
                className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0',
                    isUser ? 'bg-primary-600' : 'bg-gray-600'
                )}
            >
                {isUser ? 'U' : 'A'}
            </div>

            {/* Message Content */}
            <div className={clsx('flex-1 max-w-3xl', isUser && 'flex flex-col items-end')}>
                <div
                    className={clsx(
                        'rounded-lg px-4 py-3 relative group',
                        isUser
                            ? 'bg-primary-600 text-white'
                            : 'bg-white border border-gray-200'
                    )}
                >
                    {message.content.map((content, idx) => {
                        if (content.type === 'text') {
                            return (
                                <div key={idx} className="prose prose-sm max-w-none">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeHighlight]}
                                        className={isUser ? 'text-white' : ''}
                                    >
                                        {content.text}
                                    </ReactMarkdown>
                                </div>
                            );
                        }

                        if (content.type === 'image') {
                            return (
                                <img
                                    key={idx}
                                    src={content.url}
                                    alt={content.alt || 'Image'}
                                    className="max-w-sm rounded-lg"
                                />
                            );
                        }

                        if (content.type === 'file') {
                            return (
                                <a
                                    key={idx}
                                    href={content.url}
                                    className="flex items-center gap-2 text-sm hover:underline"
                                    download={content.filename}
                                >
                                    <span>📎</span>
                                    <span>{content.filename}</span>
                                    <span className="text-xs opacity-70">
                                        ({(content.size / 1024).toFixed(1)} KB)
                                    </span>
                                </a>
                            );
                        }

                        return null;
                    })}

                    {/* Copy Button */}
                    {!isUser && (
                        <button
                            onClick={handleCopy}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                            title="Copy message"
                        >
                            {copied ? (
                                <Check className="w-4 h-4 text-green-600" />
                            ) : (
                                <Copy className="w-4 h-4 text-gray-600" />
                            )}
                        </button>
                    )}
                </div>

                {/* Timestamp */}
                <div className="text-xs text-gray-500 mt-1 px-1">
                    {formatDistanceToNow(message.timestamp, { addSuffix: true })}
                </div>
            </div>
        </div>
    );
}
