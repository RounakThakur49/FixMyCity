import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Button from '@mui/material/Button';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import { logoutRequest } from '../../actions/auth.slice';
import type { RootState } from '../../reducers';
import fmcLogo from '../../assets/Logo.jpg';

const pages: string[] = [];
interface ResponsiveAppBarProps {
    onProfileClick?: () => void;
    onDashboardClick?: () => void;
    onUsageClick?: () => void;
    onSignUpClick?: () => void;
    onLogoClick?: () => void;
}

// ── Civic emblem: a location pin cradling a checkmark — "the city, fixed". ──
// Used as the graceful fallback when the uploaded brand logo (/logo.png) is absent.
const FixMyCityMark = ({ size = 34 }: { size?: number }) => (
    <Box
        sx={{
            width: size,
            height: size,
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
            boxShadow: '0 4px 12px rgba(15, 118, 110, 0.28)',
            flexShrink: 0,
        }}
    >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="rgba(255,255,255,0.16)"
                stroke="#ffffff"
                strokeWidth="1.6"
            />
            <path
                d="M8.7 9.2l2.3 2.3 4.3-4.3"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    </Box>
);

// ── Brand lockup: shows the uploaded platform logo (src/assets/Logo.jpg) in a
// rounded white chip so its light background reads as intentional on the frosted
// bar; falls back to the emblem + wordmark if the asset ever fails to load. ──
function BrandLockup({ compact = false }: { compact?: boolean }) {
    const [failed, setFailed] = React.useState(false);

    if (!failed) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: compact ? 0.75 : 1,
                    py: 0.5,
                    borderRadius: '12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(15, 23, 42, 0.06)',
                    boxShadow: '0 2px 8px rgba(15, 30, 28, 0.08)',
                }}
            >
                <Box
                    component="img"
                    src={fmcLogo}
                    alt="FixMyCity — Civic Grievance Portal"
                    onError={() => setFailed(true)}
                    sx={{
                        height: compact ? 34 : 44,
                        width: 'auto',
                        display: 'block',
                        objectFit: 'contain',
                    }}
                />
                <Typography
                    sx={{
                        ml: 1,
                        mr: 0.5,
                        fontSize: compact ? '1.1rem' : '1.25rem',
                        fontWeight: 700,
                        color: '#0f766e',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                    }}
                >
                    FixMyCity
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <FixMyCityMark size={compact ? 30 : 34} />
            <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                <Typography
                    component="span"
                    sx={{ fontWeight: 800, fontSize: compact ? '1.15rem' : '1.3rem', letterSpacing: '-0.02em', color: '#0f172a' }}
                >
                    Fix<Box component="span" sx={{ color: '#0f766e' }}>My</Box>City
                </Typography>
                {!compact && (
                    <Typography
                        component="span"
                        sx={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#94a3b8' }}
                    >
                        Civic Grievance Portal
                    </Typography>
                )}
            </Box>
        </Box>
    );
}

// Map role → human label + accent for the identity badge.
const roleMeta = (role: string): { label: string; color: string; bg: string } => {
    switch (role) {
        case 'superadmin':
            return { label: 'Super Admin', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.1)' };
        case 'admin':
            return { label: 'Administrator', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' };
        case 'citizen':
            return { label: 'Citizen', color: '#0f766e', bg: 'rgba(15, 118, 110, 0.1)' };
        default:
            return { label: 'Guest', color: '#64748b', bg: 'rgba(100, 116, 139, 0.1)' };
    }
};

// Icon shown beside each settings menu item (presentation only).
const settingIcon = (setting: string) => {
    switch (setting) {
        case 'Profile': return <PersonOutlineIcon fontSize="small" />;
        case 'Dashboard': return <SpaceDashboardOutlinedIcon fontSize="small" />;
        case 'Useage': return <InsightsOutlinedIcon fontSize="small" />;
        case 'Logout': return <LogoutIcon fontSize="small" />;
        default: return null;
    }
};

function ResponsiveAppBar({ onProfileClick, onDashboardClick, onUsageClick, onSignUpClick, onLogoClick }: ResponsiveAppBarProps) {
    const dispatch = useAppDispatch();
    const { user } = useSelector((state: RootState) => state.auth);
    const loginUserObj = user as any;
    const role = loginUserObj?.user?.role || '';

    const settings = role === 'superadmin'
        ? ['Profile', 'Useage', 'Dashboard', 'Logout']
        : ['Profile', 'Dashboard', 'Logout'];

    const [anchorElNav, setAnchorElNav] = React.useState<null | HTMLElement>(null);
    const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);

    const handleOpenNavMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorElNav(event.currentTarget);
    };
    const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorElUser(event.currentTarget);
    };

    const handleCloseNavMenu = () => {
        setAnchorElNav(null);
    };

    const handleCloseUserMenu = () => {
        setAnchorElUser(null);
    };

    const handleSettingClick = (setting: string) => {
        handleCloseUserMenu();
        if (setting === 'Logout') {
            dispatch(logoutRequest());
        } else if (setting === 'Dashboard') {
            if (onDashboardClick) {
                onDashboardClick();
            } else {
                window.location.href = '/';
            }
        } else if (setting === 'Useage') {
            if (onUsageClick) {
                onUsageClick();
            } else {
                alert('Usage dashboard');
            }
        } else if (setting === 'Profile') {
            if (onProfileClick) {
                onProfileClick();
            } else {
                alert(`Profile of ${loginUserObj?.user?.name || 'User'}`);
            }
        }
    };

    const userName: string = loginUserObj?.user?.name || 'User';
    const initials = userName
        .split(' ')
        .map((p: string) => p.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'U';
    const meta = roleMeta(role);

    return (
        <AppBar
            position="sticky"
            elevation={0}
            sx={{
                top: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.82)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderBottom: '1px solid rgba(15, 23, 42, 0.07)',
                color: '#0f172a',
            }}
        >
            <Container maxWidth="xl">
                <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 72 } }}>
                    {/* ── Brand lockup (desktop) ───────────────────────────── */}
                    <Box
                        component="a"
                        href="#"
                        onClick={(e: React.MouseEvent) => { e.preventDefault(); onLogoClick?.(); }}
                        sx={{
                            display: { xs: 'none', md: 'flex' },
                            alignItems: 'center',
                            mr: 3,
                            textDecoration: 'none',
                            cursor: 'pointer',
                        }}
                    >
                        <BrandLockup />
                    </Box>

                    {/* Legacy nav menu (kept — renders only if pages populated) */}
                    <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' } }}>
                        {pages.length > 0 && (
                            <>
                                <IconButton
                                    aria-label="account of current user"
                                    aria-controls="menu-appbar"
                                    aria-haspopup="true"
                                    onClick={handleOpenNavMenu}
                                    color="inherit"
                                    sx={{ p: 1 }}
                                >
                                    <SpaceDashboardOutlinedIcon />
                                </IconButton>
                                <Menu
                                    id="menu-appbar"
                                    anchorEl={anchorElNav}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                                    keepMounted
                                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                                    open={Boolean(anchorElNav)}
                                    onClose={handleCloseNavMenu}
                                    sx={{ display: { xs: 'block', md: 'none' } }}
                                >
                                    {pages.map((page) => (
                                        <MenuItem key={page} onClick={handleCloseNavMenu}>
                                            <Typography sx={{ textAlign: 'center', fontWeight: 700, width: '100%' }}>
                                                {page}
                                            </Typography>
                                        </MenuItem>
                                    ))}
                                </Menu>
                            </>
                        )}
                    </Box>

                    {/* ── Brand lockup (mobile, centered) ──────────────────── */}
                    <Box
                        onClick={() => onLogoClick?.()}
                        sx={{
                            display: { xs: 'flex', md: 'none' },
                            alignItems: 'center',
                            flexGrow: 1,
                            cursor: 'pointer',
                        }}
                    >
                        <BrandLockup compact />
                    </Box>

                    {/* spacer pushes identity cluster to the right on desktop */}
                    <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' } }} />

                    {/* Sign Up button — visible only when not logged in */}
                    {!loginUserObj && onSignUpClick && (
                        <Button
                            variant="contained"
                            onClick={onSignUpClick}
                            sx={{
                                borderRadius: '999px',
                                px: 3,
                                py: 1,
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                textTransform: 'none',
                                backgroundColor: '#0f766e',
                                '&:hover': { backgroundColor: '#0b5250' },
                            }}
                        >
                            Sign Up
                        </Button>
                    )}

                    {loginUserObj && (
                        <Box sx={{ flexGrow: 0, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            {/* Role badge — hidden on the smallest screens */}
                            <Box
                                sx={{
                                    display: { xs: 'none', sm: 'flex' },
                                    alignItems: 'center',
                                    gap: 0.75,
                                    px: 1.25,
                                    py: 0.5,
                                    borderRadius: '999px',
                                    backgroundColor: meta.bg,
                                }}
                            >
                                <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: meta.color }} />
                                <Typography
                                    sx={{
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        letterSpacing: '0.02em',
                                        color: meta.color,
                                    }}
                                >
                                    {meta.label}
                                </Typography>
                            </Box>

                            <Tooltip title="Account & settings">
                                <IconButton
                                    onClick={handleOpenUserMenu}
                                    sx={{
                                        p: 0.4,
                                        border: '2px solid rgba(15, 118, 110, 0.18)',
                                        transition: 'border-color 0.2s ease',
                                        '&:hover': { borderColor: 'rgba(15, 118, 110, 0.45)' },
                                    }}
                                >
                                    <Avatar
                                        alt={userName}
                                        sx={{
                                            width: 38,
                                            height: 38,
                                            fontSize: '0.9rem',
                                            fontWeight: 800,
                                            color: '#ffffff',
                                            background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
                                        }}
                                    >
                                        {initials}
                                    </Avatar>
                                </IconButton>
                            </Tooltip>
                            <Menu
                                sx={{ mt: '48px' }}
                                id="menu-appbar"
                                anchorEl={anchorElUser}
                                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                                keepMounted
                                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                open={Boolean(anchorElUser)}
                                onClose={handleCloseUserMenu}
                                slotProps={{ paper: { sx: { minWidth: 216 } } }}
                            >
                                {/* Identity header inside the menu */}
                                <Box sx={{ px: 2, pt: 1.25, pb: 1.5 }}>
                                    <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a', lineHeight: 1.2 }}>
                                        {userName}
                                    </Typography>
                                    <Typography sx={{ fontSize: '0.75rem', color: meta.color, fontWeight: 700, mt: 0.25 }}>
                                        {meta.label}
                                    </Typography>
                                </Box>
                                <Divider sx={{ mb: 0.5 }} />
                                {settings.map((setting) => {
                                    const isLogout = setting === 'Logout';
                                    return (
                                        <MenuItem
                                            key={setting}
                                            onClick={() => handleSettingClick(setting)}
                                            sx={isLogout ? {
                                                color: '#dc2626',
                                                '& .MuiListItemIcon-root': { color: '#dc2626' },
                                            } : undefined}
                                        >
                                            <ListItemIcon sx={{ minWidth: 34, color: '#475569' }}>
                                                {settingIcon(setting)}
                                            </ListItemIcon>
                                            <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                {setting === 'Useage' ? 'Usage Analytics' : setting}
                                            </Typography>
                                        </MenuItem>
                                    );
                                })}
                            </Menu>
                        </Box>
                    )}
                </Toolbar>
            </Container>
        </AppBar >
    );
}
export default ResponsiveAppBar;
