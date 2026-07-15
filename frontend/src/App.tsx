import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { Box } from '@mui/material';
import ResponsiveAppBar from './components/layout/ResponsiveAppBar';
import TabGroup from './components/layout/TabGroup';
import LandingPage from './components/layout/LandingPage';
import UserHome from './components/layout/userHome';
import AdminHome from './components/layout/adminHome';
import ComplaintRegister from './components/layout/complaintRegister';
import Profile from './components/layout/Profile';
// Usage analytics component for superadmin
import Useage from './components/layout/useage.tsx';
import type { RootState } from './reducers';

function App() {
    const { user } = useSelector((state: RootState) => state.auth);
    // Persist the active view across page refreshes so a superadmin sitting on the
    // usage page doesn't get bounced back to the dashboard on reload.
    const [view, setView] = useState<'home' | 'register-complaint' | 'usage'>(
        () => (sessionStorage.getItem('view') as 'home' | 'register-complaint' | 'usage') || 'home'
    );
    const [profileOpen, setProfileOpen] = useState(false);
    const [showAuth, setShowAuth] = useState(false);

    // Extract role from the logged-in user object
    // Backend returns: { token, user: { id, name, phone, role } }
    const loginUserObj = user as any;
    const role   = loginUserObj?.user?.role || loginUserObj?.role || '';
    const userId = loginUserObj?.user?.id   || loginUserObj?.id;

    // Keep the persisted view in sync so a refresh restores the current screen.
    useEffect(() => {
        sessionStorage.setItem('view', view);
    }, [view]);

    // Reset the view only when the logged-in identity actually changes (login /
    // logout / role switch) — NOT on the rehydration that happens on every refresh.
    const prevUserIdRef = useRef<string | undefined>(userId);
    useEffect(() => {
        if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
            setView('home');
            setProfileOpen(false);
        }
        // Handle logout (id goes from defined -> undefined) as well.
        if (prevUserIdRef.current !== undefined && userId === undefined) {
            setView('home');
            setProfileOpen(false);
            setShowAuth(false);
        }
        prevUserIdRef.current = userId;
    }, [userId]);

    return (
        <>
            <ResponsiveAppBar
                onProfileClick={() => setProfileOpen(true)}
                onDashboardClick={() => setView('home')}
                onUsageClick={() => setView('usage')}
                onSignUpClick={!showAuth ? () => setShowAuth(true) : undefined}
                onLogoClick={() => setShowAuth(false)}
            />
            <Box
                component="main"
                key={`${role}-${view}`}
                sx={{
                    minHeight: 'calc(100vh - 72px)',
                    backgroundColor: '#e6eef0',
                    backgroundImage:
                        'radial-gradient(rgba(15,118,110,0.06) 1px, transparent 1px),' +
                        'radial-gradient(1100px 720px at 88% -10%, rgba(20,184,166,0.20), transparent 60%),' +
                        'radial-gradient(1000px 640px at -8% 112%, rgba(37,99,235,0.15), transparent 58%),' +
                        'radial-gradient(760px 520px at 50% 128%, rgba(15,118,110,0.12), transparent 62%)',
                    backgroundSize: '22px 22px, 100% 100%, 100% 100%, 100% 100%',
                    backgroundAttachment: 'fixed, fixed, fixed, fixed',
                    animation: 'fmcViewFade 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
                    '@keyframes fmcViewFade': {
                        from: { opacity: 0, transform: 'translateY(6px)' },
                        to: { opacity: 1, transform: 'translateY(0)' },
                    },
                }}
            >
                {role === 'citizen' ? (
                    <>
                        {view === 'home' && (
                            <UserHome onRegisterClick={() => setView('register-complaint')} />
                        )}
                        {view === 'register-complaint' && (
                            <ComplaintRegister onCancel={() => setView('home')} />
                        )}
                    </>
                ) : role === 'admin' ? (
                    <AdminHome />
                ) : role === 'superadmin' ? (
                    <>
                        {view === 'home' && <AdminHome />}
                        {view === 'usage' && <Useage />}
                    </>
                ) : showAuth ? (
                    <TabGroup />
                ) : (
                    <LandingPage onSignUp={() => setShowAuth(true)} />
                )}
            </Box>

            {/* Profile Modal — rendered as an overlay on top of any view */}
            <Profile open={profileOpen} onClose={() => setProfileOpen(false)} />
        </>
    );
}

export default App;
