# OpenClaw Web Chat

Modern React-based web chat interface for OpenClaw.

## Features

- 🔐 User authentication
- 💬 Real-time chat with WebSocket
- 🤖 Multiple agent support
- 📁 File upload support
- 📱 Responsive design (mobile, tablet, desktop)
- 🎨 Modern UI with TailwindCSS
- ⚡ Fast development with Vite

## Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **Socket.IO** - WebSocket client
- **React Router** - Routing
- **React Markdown** - Message rendering

## Getting Started

### Prerequisites

- Node.js 18+ or pnpm
- OpenClaw Gateway running on `http://localhost:3000`

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
# Build
npm run build

# Preview production build
npm run preview
```

## Environment Variables

Create a `.env` file:

```bash
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_ENABLE_FILE_UPLOAD=true
VITE_ENABLE_MARKDOWN=true
VITE_MAX_FILE_SIZE=10485760
VITE_APP_NAME=OpenClaw Chat
```

## Project Structure

```
web-chat/
├── src/
│   ├── components/
│   │   ├── Auth/          # Login, ProtectedRoute
│   │   ├── Chat/          # ChatWindow, MessageBubble, MessageInput
│   │   ├── Sidebar/       # AgentSelector, SessionList
│   │   └── Layout/        # AppLayout
│   ├── contexts/          # AuthContext, ChatContext
│   ├── lib/               # WebSocket, API client
│   ├── pages/             # LoginPage, ChatPage
│   ├── types/             # TypeScript types
│   ├── App.tsx            # Root component
│   ├── main.tsx           # Entry point
│   └── index.css          # Global styles
├── public/                # Static assets
├── index.html             # HTML template
├── package.json           # Dependencies
├── vite.config.ts         # Vite configuration
├── tailwind.config.js     # Tailwind configuration
└── tsconfig.json          # TypeScript configuration
```

## Usage

### Login

1. Navigate to `/login`
2. Enter email and password
3. Click "Sign in"

### Chat

1. Select an agent from the dropdown
2. Type a message in the input box
3. Press Enter to send (Shift+Enter for new line)
4. Upload files using the paperclip icon

### Sessions

- Create new session: Click "New Session" button
- Switch sessions: Click on a session in the sidebar
- Delete session: Hover over session and click trash icon

## Development

### Run Tests

```bash
npm run test
```

### Lint

```bash
npm run lint
```

### Format

```bash
npm run format
```

## License

MIT
