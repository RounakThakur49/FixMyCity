import React, { useState } from 'react';
import './Registration.css';
import { Divider, IconButton } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import type { RootState } from '../../reducers';
import {
    loginRequest,
    otpVerifyRequest,
    otpCancel,
} from '../../actions/auth.slice';

interface LoginProps {
    setValue: (value: string) => void;
}

export default function Login({ setValue }: LoginProps) {
    const dispatch = useAppDispatch();
    const {
        loading,
        error,
        otpPending,
        pendingToken,
        otpLoading,
        otpError,
    } = useSelector((state: RootState) => state.auth);

    // Only Citizen and Admin are shown publicly.
    // Superadmin logs in through the Admin toggle — the backend detects the
    // superadmin account and triggers the Brevo OTP step automatically.
    // The "superadmin" role is never a visible option in the UI.
    const [loginMode, setLoginMode] = useState<'citizen' | 'admin'>('citizen');
    const [identifier, setIdentifier] = useState('');
    const [password,   setPassword]   = useState('');
    const [otp,        setOtp]        = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // ── Submit login form ─────────────────────────────────────────────────────
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        dispatch(loginRequest({
            email:      identifier,   // backend accepts both email and identifier
            identifier,
            password,
            role: loginMode,          // 'citizen' or 'admin'; backend routes accordingly
        }));
    };

    // ── Submit OTP ────────────────────────────────────────────────────────────
    const handleVerifyOtp = (e: React.FormEvent) => {
        e.preventDefault();
        if (!pendingToken) return;
        dispatch(otpVerifyRequest({ otp: otp.trim(), pendingToken }));
    };

    // ── Switch login mode ─────────────────────────────────────────────────────
    const switchMode = (mode: 'citizen' | 'admin') => {
        setLoginMode(mode);
        setIdentifier('');
        setPassword('');
    };

    // ── OTP Verification screen ───────────────────────────────────────────────
    // Shown only when the backend returns requiresOtp:true (superadmin login).
    // This screen is NOT reachable by regular citizens or admins.
    if (otpPending) {
        return (
            <div className="registration-shell" style={{ minHeight: 'auto', padding: '5' }}>
                <div className="reg-hero-panel">
                    <div className="form-title-group">
                        <h2>OTP Verification</h2>
                        <p>
                            A 6-digit verification code has been sent to your registered
                            email address. Enter the code below to complete sign-in.
                        </p>
                    </div>
                    <form className="auth-form-modern" onSubmit={handleVerifyOtp} noValidate>
                        <div className="input-group">
                            <label htmlFor="login-otp">Enter OTP</label>
                            <div className="input-wrapper">
                                <svg
                                    className="input-icon"
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16" height="16"
                                    viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2"
                                    strokeLinecap="round" strokeLinejoin="round"
                                >
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                                <input
                                    required
                                    id="login-otp"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    placeholder="6-digit code"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    autoFocus
                                />
                            </div>
                        </div>

                        {otpError && (
                            <div
                                role="alert"
                                style={{
                                    background: 'rgba(239,68,68,0.1)',
                                    border: '1px solid rgba(239,68,68,0.4)',
                                    borderRadius: '8px',
                                    color: '#dc2626',
                                    padding: '0.6rem 1rem',
                                    fontSize: '0.875rem',
                                    marginBottom: '1rem',
                                    textAlign: 'center',
                                }}
                            >
                                {otpError}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="primary-btn"
                            disabled={otpLoading || otp.length !== 6}
                        >
                            {otpLoading ? 'Verifying…' : 'Verify & Log In'}
                        </button>

                        <button
                            type="button"
                            className="ghost-btn"
                            style={{ marginTop: '1rem', width: '100%' }}
                            onClick={() => {
                                setOtp('');
                                dispatch(otpCancel());
                            }}
                        >
                            Cancel
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ── Main login form ───────────────────────────────────────────────────────
    return (
        <div className="registration-shell" style={{ minHeight: 'auto', padding: '5' }}>
            <div className="reg-hero-panel">

                <div className="form-title-group">
                    <h2>Login</h2>
                    <p>Enter your credentials to access your account.</p>
                </div>

                <form className="auth-form-modern" onSubmit={handleSubmit} noValidate autoComplete="off">

                    {/* Mode toggle — Citizen / Admin only (superadmin hidden) */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                        <div className="mode-toggle-pill">
                            <button
                                type="button"
                                className={`mode-btn ${loginMode === 'citizen' ? 'is-active' : ''}`}
                                onClick={() => switchMode('citizen')}
                                disabled={loading}
                            >
                                Citizen
                            </button>
                            <button
                                type="button"
                                className={`mode-btn ${loginMode === 'admin' ? 'is-active' : ''}`}
                                onClick={() => switchMode('admin')}
                                disabled={loading}
                            >
                                Admin
                            </button>
                        </div>
                    </div>

                    {/* Identifier field */}
                    <div className="input-group">
                        <label htmlFor="login-identifier">
                            {loginMode === 'citizen' ? 'Mobile / Email' : 'Username / Email'}
                        </label>
                        <div className="input-wrapper">
                            <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                            <input
                                required
                                id="login-identifier"
                                type="text"
                                placeholder={loginMode === 'citizen' ? 'Mobile number or email' : 'username or email'}
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Password field */}
                    <div className="input-group">
                        <label htmlFor="login-password">Password</label>
                        <div className="input-wrapper">
                            <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            <input
                                required
                                id="login-password"
                                type={showPassword ? 'text' : 'password'}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                disabled={loading}
                            />
                            <IconButton
                                onClick={() => setShowPassword(v => !v)}
                                size="small"
                                tabIndex={-1}
                                sx={{
                                    position: 'absolute',
                                    right: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: '#94a3b8',
                                    '&:hover': { color: '#64748b' },
                                }}
                            >
                                {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                            </IconButton>
                        </div>
                    </div>

                    {/* Error banner */}
                    {error && (
                        <div
                            role="alert"
                            style={{
                                background: 'rgba(239,68,68,0.1)',
                                border: '1px solid rgba(239,68,68,0.4)',
                                borderRadius: '8px',
                                color: '#dc2626',
                                padding: '0.6rem 1rem',
                                fontSize: '0.875rem',
                                marginBottom: '1rem',
                                textAlign: 'center',
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        type="submit"
                        className="primary-btn"
                        style={{ marginTop: '1rem' }}
                        disabled={loading}
                    >
                        {loading ? 'Logging in…' : 'Log In'}
                    </button>
                </form>

                <Divider sx={{ my: 3, borderColor: 'rgba(12, 24, 22, 0.15)' }}/>

                <div className="reg-footer-note">
                    <span>Don't have an account?</span>
                    <button type="button" className="ghost-btn" onClick={() => setValue('1')}>
                        Register
                    </button>
                </div>
            </div>
        </div>
    );
}
