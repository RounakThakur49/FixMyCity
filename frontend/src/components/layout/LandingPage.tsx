import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import Chip from '@mui/material/Chip';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { apiBaseFMCClient } from '../../apis/axios.baseClient';
import heroImg from '../../assets/background1.jpg';

interface LandingPageProps {
    onSignUp: () => void;
}

function LandingPage({ onSignUp }: LandingPageProps) {
    const [stats, setStats] = useState({ totalComplaints: 0, resolvedComplaints: 0, registeredCitizens: 0 });

    useEffect(() => {
        apiBaseFMCClient.get('/api/stats')
            .then(res => setStats(res.data))
            .catch(() => {});
    }, []);

    const resolutionRate = stats.totalComplaints > 0
        ? Math.round((stats.resolvedComplaints / stats.totalComplaints) * 100)
        : 0;

    return (
        <Box
            sx={{
                minHeight: 'calc(100vh - 72px)',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: '#f4f8f6',
            }}
        >
            {/* Decorative teal square outline — top right */}
            <Box
                sx={{
                    position: 'absolute',
                    top: { xs: 20, md: 40 },
                    right: { xs: -30, md: 60 },
                    width: { xs: 80, md: 120 },
                    height: { xs: 80, md: 120 },
                    border: '3px solid rgba(20, 184, 166, 0.3)',
                    borderRadius: '8px',
                    transform: 'rotate(12deg)',
                    pointerEvents: 'none',
                }}
            />

            {/* Decorative dot grid — top left */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 80,
                    left: 40,
                    width: 60,
                    height: 60,
                    backgroundImage: 'radial-gradient(circle, rgba(15,118,110,0.2) 1.5px, transparent 1.5px)',
                    backgroundSize: '12px 12px',
                    pointerEvents: 'none',
                    display: { xs: 'none', md: 'block' },
                }}
            />

            <Container
                maxWidth="xl"
                sx={{
                    pt: { xs: 6, md: 10 },
                    pb: { xs: 6, md: 10 },
                    display: 'flex',
                    flexDirection: { xs: 'column', lg: 'row' },
                    alignItems: 'center',
                    gap: { xs: 6, lg: 8 },
                    position: 'relative',
                    zIndex: 1,
                }}
            >
                {/* ─── Left column: text content ─── */}
                <Box sx={{ flex: 1, maxWidth: { lg: '55%' } }}>
                    {/* Tagline chip */}
                    <Chip
                        icon={<AutoAwesomeIcon sx={{ fontSize: 16, color: '#14b8a6 !important' }} />}
                        label="CIVIC REPORTING, REIMAGINED"
                        sx={{
                            mb: 4,
                            backgroundColor: 'rgba(20, 184, 166, 0.08)',
                            border: '1px solid rgba(20, 184, 166, 0.2)',
                            color: '#0f766e',
                            fontWeight: 700,
                            fontSize: '0.72rem',
                            letterSpacing: '0.08em',
                            px: 1,
                            height: 32,
                            '& .MuiChip-icon': { ml: 0.5 },
                        }}
                    />

                    {/* Hero headline: REPORT. TRACK. FIX. */}
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            component="h1"
                            sx={{
                                fontSize: { xs: '3.2rem', sm: '4.2rem', md: '5.5rem', lg: '6rem' },
                                fontWeight: 900,
                                fontStyle: 'italic',
                                lineHeight: 0.95,
                                letterSpacing: '-0.03em',
                                color: '#0f172a',
                            }}
                        >
                            REPORT.
                        </Typography>
                        <Typography
                            component="h1"
                            sx={{
                                fontSize: { xs: '3.2rem', sm: '4.2rem', md: '5.5rem', lg: '6rem' },
                                fontWeight: 900,
                                fontStyle: 'italic',
                                lineHeight: 0.95,
                                letterSpacing: '-0.03em',
                                color: '#14b8a6',
                            }}
                        >
                            TRACK.
                        </Typography>
                        <Typography
                            component="h1"
                            sx={{
                                fontSize: { xs: '3.2rem', sm: '4.2rem', md: '5.5rem', lg: '6rem' },
                                fontWeight: 900,
                                fontStyle: 'italic',
                                lineHeight: 0.95,
                                letterSpacing: '-0.03em',
                                color: '#0f172a',
                            }}
                        >
                            FIX.
                        </Typography>
                    </Box>

                    {/* Subtitle */}
                    <Typography
                        sx={{
                            fontSize: { xs: '1rem', md: '1.1rem' },
                            color: '#475569',
                            lineHeight: 1.7,
                            maxWidth: 520,
                            mb: 4,
                        }}
                    >
                        Spotted a pothole, broken streetlight, or neighborhood eyesore?
                        FixMyCity connects residents directly to the right city department
                        — and keeps you updated every step of the way.
                    </Typography>

                    {/* CTA button */}
                    <Button
                        variant="contained"
                        size="large"
                        endIcon={<ArrowForwardIcon />}
                        onClick={onSignUp}
                        sx={{
                            backgroundColor: '#0f766e',
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            px: 4,
                            py: 1.6,
                            borderRadius: '12px',
                            boxShadow: '0 8px 24px rgba(15, 118, 110, 0.3)',
                            '&:hover': {
                                backgroundColor: '#0b5250',
                                boxShadow: '0 12px 32px rgba(15, 118, 110, 0.4)',
                                transform: 'translateY(-1px)',
                            },
                            transition: 'all 0.2s ease',
                        }}
                    >
                        Report an Issue
                    </Button>

                    {/* Stats line */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 4 }}>
                        <AvatarGroup
                            max={4}
                            sx={{
                                '& .MuiAvatar-root': {
                                    width: 28,
                                    height: 28,
                                    fontSize: '0.7rem',
                                    border: '2px solid #f4f8f6',
                                    backgroundColor: '#14b8a6',
                                    color: '#ffffff',
                                },
                            }}
                        >
                            <Avatar>C1</Avatar>
                            <Avatar sx={{ bgcolor: '#0f766e' }}>C2</Avatar>
                            <Avatar sx={{ bgcolor: '#059669' }}>C3</Avatar>
                            <Avatar sx={{ bgcolor: '#2563eb' }}>C4</Avatar>
                        </AvatarGroup>
                        <Typography sx={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
                            <Box component="span" sx={{ fontWeight: 700, color: '#0f172a' }}>
                                {stats.registeredCitizens}
                            </Box>
                            {' '}citizens reported issues this month
                        </Typography>
                    </Box>
                </Box>

                {/* ─── Right column: city image + overlays ─── */}
                <Box
                    sx={{
                        flex: 1,
                        position: 'relative',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        maxWidth: { lg: '45%' },
                        minHeight: { xs: 320, md: 480 },
                    }}
                >
                    {/* Decorative frame behind image */}
                    <Box
                        sx={{
                            position: 'absolute',
                            top: -12,
                            right: -12,
                            bottom: 12,
                            left: 12,
                            border: '2.5px solid rgba(20, 184, 166, 0.25)',
                            borderRadius: '24px',
                        }}
                    />

                    {/* City image */}
                    <Box
                        component="img"
                        src={heroImg}
                        alt="City skyline"
                        sx={{
                            width: '100%',
                            maxWidth: 500,
                            height: { xs: 320, md: 440 },
                            objectFit: 'cover',
                            borderRadius: '20px',
                            boxShadow: '0 20px 60px rgba(15, 23, 42, 0.15)',
                            position: 'relative',
                            zIndex: 1,
                        }}
                    />

                    {/* Floating "Live Report" card */}
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: { xs: -20, md: 20 },
                            left: { xs: -10, md: -40 },
                            zIndex: 2,
                            backgroundColor: '#ffffff',
                            borderRadius: '16px',
                            p: 2,
                            px: 2.5,
                            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
                            border: '1px solid rgba(15, 23, 42, 0.06)',
                            minWidth: 200,
                        }}
                    >
                        <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', mb: 0.5 }}>
                            Live Report
                        </Typography>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', mb: 1 }}>
                            Pothole on MG Road
                        </Typography>
                        <Chip
                            label="In Review"
                            size="small"
                            sx={{
                                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                color: '#2563eb',
                                fontWeight: 600,
                                fontSize: '0.7rem',
                                height: 24,
                            }}
                        />
                    </Box>

                    {/* Resolution rate badge */}
                    <Box
                        sx={{
                            position: 'absolute',
                            top: { xs: -10, md: 30 },
                            right: { xs: -10, md: -30 },
                            zIndex: 2,
                            backgroundColor: '#ffffff',
                            borderRadius: '14px',
                            p: 1.5,
                            px: 2,
                            boxShadow: '0 8px 28px rgba(15, 23, 42, 0.1)',
                            border: '1px solid rgba(15, 23, 42, 0.06)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        <CheckCircleIcon sx={{ color: '#059669', fontSize: 20 }} />
                        <Box>
                            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                                {resolutionRate}%
                            </Typography>
                            <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: '#64748b', letterSpacing: '0.04em' }}>
                                Resolution rate
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            </Container>
        </Box>
    );
}

export default LandingPage;
