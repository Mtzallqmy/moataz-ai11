import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

// Contexts
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'

// Pages
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Providers from './pages/Providers'
import Integrations from './pages/Integrations'
import Settings from './pages/Settings'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import NotFound from './pages/NotFound'

// Components
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'

// Types
import { User } from './types'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">جارٍ التحقق من الجلسة...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { user, logout } = useAuth()
  const location = useLocation()

  // Auto close sidebar on mobile when route changes
  useEffect(() => {
    if (window.innerWidth < 768) {
      setSidebarOpen(false)
    }
  }, [location.pathname])

  if (!user) return <>{children}</>

  return (
    <div className="flex h-screen bg-dark-950 text-dark-100 overflow-hidden">
      {/* Sidebar */}
      <div className={`fixed md:static inset-y-0 right-0 z-50 w-72 transform transition-transform duration-300 md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} onLogout={logout} />
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar 
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} 
          sidebarOpen={sidebarOpen}
          user={user}
        />
        
        <main className="flex-1 overflow-auto bg-dark-950">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />

          {/* Protected Routes */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          } />
          
          <Route path="/chat" element={
            <ProtectedRoute>
              <AppLayout>
                <Chat />
              </AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/chat/:chatId" element={
            <ProtectedRoute>
              <AppLayout>
                <Chat />
              </AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/providers" element={
            <ProtectedRoute>
              <AppLayout>
                <Providers />
              </AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/integrations" element={
            <ProtectedRoute>
              <AppLayout>
                <Integrations />
              </AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/settings" element={
            <ProtectedRoute>
              <AppLayout>
                <Settings />
              </AppLayout>
            </ProtectedRoute>
          } />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
