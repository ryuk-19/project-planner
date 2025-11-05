import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { useToastStore } from './stores/toastStore';
import { useSocketStore } from './stores/socketStore';
import { PrivateRoute } from './components/layout/PrivateRoute';
import { Navbar } from './components/layout/Navbar';
import { Loading } from './components/common';
import { ToastContainer } from './components/notifications/Toast';
import { useSocket } from './hooks/useSocket';

// Pages
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import OAuthCallbackPage from './pages/auth/OAuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import TeamPage from './pages/TeamPage';
import ProjectPage from './pages/ProjectPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import InvitationsPage from './pages/InvitationsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function AppContent() {
  const { checkAuth, isLoading, isAuthenticated } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const { toasts, removeToast, addToast } = useToastStore();
  const { on, off, emit, isConnected } = useSocketStore();
  const queryClient = useQueryClient();
  const location = useLocation();
  
  // Initialize Socket.io connection
  useSocket();

  useEffect(() => {
    checkAuth();
    setTheme(theme);
  }, [checkAuth, theme, setTheme]);

  // Debounced invalidation helper
  const debounceMap: Record<string, number> = {};
  const debounceInvalidate = (key: string[], ms = 200) => {
    const mapKey = JSON.stringify(key);
    if (debounceMap[mapKey]) {
      clearTimeout(debounceMap[mapKey]);
    }
    // @ts-ignore - keep simple for debounce storage
    debounceMap[mapKey] = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: key });
      // @ts-ignore
      clearTimeout(debounceMap[mapKey]);
      // @ts-ignore
      delete debounceMap[mapKey];
    }, ms);
  };

  // Listen for real-time notifications/invitations and invalidate caches
  useEffect(() => {
    const handleNewNotification = (data: any) => {
      addToast({
        message: data.message || 'New notification',
        type: 'info',
        onClick: () => {
          if (data.link) {
            window.location.href = data.link;
          }
        },
      });
      debounceInvalidate(['notifications']);
    };

    const handleTaskCreated = (data: any) => {
      addToast({
        message: `New task created: ${data.task?.name || 'Unknown'}`,
        type: 'success',
      });
    };

    const handleTaskUpdated = (data: any) => {
      addToast({
        message: `Task updated: ${data.task?.name || 'Unknown'}`,
        type: 'info',
      });
    };

    const handleProjectUpdated = (data: any) => {
      addToast({
        message: `Project updated: ${data.project?.name || 'Unknown'}`,
        type: 'info',
      });
    };

    const handleInvitationReceived = (data: any) => {
      addToast({
        message: `New team invitation from ${data.team?.name || 'a team'}`,
        type: 'info',
        onClick: () => {
          window.location.href = '/invitations';
        },
      });
      debounceInvalidate(['invitations']);
    };

    const handleProjectAccessRevoked = () => {
      debounceInvalidate(['my-projects']);
    };

    const handleProjectDeleted = () => {
      debounceInvalidate(['my-projects']);
    };

    if (isAuthenticated) {
      on('notification:new', handleNewNotification);
      on('task:created', handleTaskCreated);
      on('task:updated', handleTaskUpdated);
      on('project:updated', handleProjectUpdated);
      on('invitation:received', handleInvitationReceived);
      on('project:access_revoked', handleProjectAccessRevoked);
      on('project:deleted', handleProjectDeleted);
    }

    return () => {
      off('notification:new', handleNewNotification);
      off('task:created', handleTaskCreated);
      off('task:updated', handleTaskUpdated);
      off('project:updated', handleProjectUpdated);
      off('invitation:received', handleInvitationReceived);
      off('project:access_revoked', handleProjectAccessRevoked);
      off('project:deleted', handleProjectDeleted);
    };
  }, [isAuthenticated, on, off, addToast, queryClient]);

  // Reconnect robustness: on connect, rejoin team/project rooms and refresh key queries
  useEffect(() => {
    if (!isAuthenticated || !isConnected) return;

    // Rejoin all team rooms from cache (fallback to fetch if missing)
    const teams: any[] | undefined = queryClient.getQueryData(['my-teams']) as any;
    const joinTeams = async () => {
      let teamList = teams;
      if (!teamList) {
        try {
          const resp = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/teams?includePersonal=true`, {
            credentials: 'include',
          });
          const data = await resp.json();
          teamList = data?.teams || [];
        } catch {}
      }
      if (Array.isArray(teamList)) {
        teamList.forEach((t) => {
          const id = typeof t === 'string' ? t : t._id;
          if (id) emit('join:team', id);
        });
      }
    };

    // Rejoin current project room if on a project route
    const match = location.pathname.match(/^\/projects\/([^/]+)/);
    if (match && match[1]) {
      emit('join:project', match[1]);
      // One-shot refresh for current project/tasks after reconnect
      debounceInvalidate(['project', match[1]], 150);
      debounceInvalidate(['tasks', match[1]], 150);
    }

    // Refresh notifications and invitations quickly on reconnect
    debounceInvalidate(['notifications'], 150);
    debounceInvalidate(['invitations'], 150);
    debounceInvalidate(['my-projects'], 150);

    joinTeams();
  }, [isAuthenticated, isConnected, emit, location.pathname, queryClient]);

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          {isAuthenticated && <Navbar />}
          
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/callback" element={<OAuthCallbackPage />} />

            {/* Private routes */}
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <DashboardPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/teams/:teamId"
              element={
                <PrivateRoute>
                  <TeamPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/projects/:projectId"
              element={
                <PrivateRoute>
                  <ProjectPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <PrivateRoute>
                  <NotificationsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <PrivateRoute>
                  <ProfilePage />
                </PrivateRoute>
              }
            />
            <Route
              path="/invitations"
              element={
                <PrivateRoute>
                  <InvitationsPage />
                </PrivateRoute>
              }
            />

            {/* Redirect root to dashboard or login */}
            <Route
              path="/"
              element={
                isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />
              }
            />

            {/* 404 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts.map(toast => ({ ...toast, onClose: removeToast }))} />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

