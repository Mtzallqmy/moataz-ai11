import React, { createContext, useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { User } from '../types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<boolean>
  register: (name: string, email: string, password: string) => Promise<boolean>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = 'moataz_user'
const USERS_KEY = 'moataz_users'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // Load user from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem(STORAGE_KEY)
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    setIsLoading(false)
  }, [])

  const saveUser = (userData: User) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
    setUser(userData)
  }

  const login = async (email: string, password: string): Promise<boolean> => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 600))

    const usersRaw = localStorage.getItem(USERS_KEY)
    const users: any[] = usersRaw ? JSON.parse(usersRaw) : []

    const foundUser = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password)

    if (foundUser) {
      const userData: User = {
        id: foundUser.id,
        name: foundUser.name,
        email: foundUser.email,
        avatar: foundUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${foundUser.name}`,
        createdAt: foundUser.createdAt,
      }
      saveUser(userData)
      toast.success(`مرحباً بعودتك، ${userData.name.split(' ')[0]}!`)
      return true
    } else {
      toast.error('البريد الإلكتروني أو كلمة المرور غير صحيحة')
      return false
    }
  }

  const register = async (name: string, email: string, password: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 700))

    const usersRaw = localStorage.getItem(USERS_KEY)
    const users: any[] = usersRaw ? JSON.parse(usersRaw) : []

    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      toast.error('هذا البريد الإلكتروني مسجل بالفعل')
      return false
    }

    const newUser = {
      id: 'user_' + Date.now(),
      name,
      email: email.toLowerCase(),
      password, // In real app: never store plain password. Use backend hash.
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      createdAt: new Date().toISOString(),
    }

    users.push(newUser)
    localStorage.setItem(USERS_KEY, JSON.stringify(users))

    const userData: User = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      avatar: newUser.avatar,
      createdAt: newUser.createdAt,
    }

    saveUser(userData)
    toast.success('تم إنشاء الحساب بنجاح! مرحباً بك في معتز العلقمي')
    return true
  }

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
    toast.info('تم تسجيل الخروج بنجاح')
    navigate('/login')
  }

  const updateUser = (updates: Partial<User>) => {
    if (!user) return
    const updated = { ...user, ...updates }
    saveUser(updated)
    toast.success('تم تحديث الملف الشخصي')
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
