import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Button,
    Dialog,
    DialogContent,
    IconButton,
    Grid,
    Chip,
    CircularProgress,
    Alert,
    Card,
    CardContent,
    CardMedia,
    Divider,
    Tabs,
    Tab
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import { 
    AccessTime as ClockIcon, 
    Build as WrenchIcon, 
    CheckCircle as TickIcon 
} from '@mui/icons-material';
import ComplaintMap from './complaintMap';
import { getComplaintDetails } from '../../apis/functions';
import UpdateStatus from './updateStatus';

interface ComplaintDetailsProps {
    complaint: any;
    role: 'admin' | 'citizen' | 'superadmin';
    userId: string;
    onClose: () => void;
    onUpdateStatus?: (complaint: any) => void;
}

export default function ComplaintDetails({ complaint, role, userId, onClose, onUpdateStatus }: ComplaintDetailsProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fullComplaint, setFullComplaint] = useState<any>(complaint);
    const [statusUpdates, setStatusUpdates] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState(0);
    const [reloadTrigger, setReloadTrigger] = useState(0);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                setLoading(true);
                setError(null);
                const complaintId = complaint.id || complaint._id;
                const data = await getComplaintDetails({ complaintId, role, userId });

                if (data && data.success && data.complaint) {
                    setFullComplaint(data.complaint);
                    setStatusUpdates(data.statusUpdates || []);
                } else if (data && typeof data === 'object' && !Array.isArray(data) && (data.title || data.description || data.issuetype)) {
                    setFullComplaint(data);
                    setStatusUpdates(data.statusUpdates || []);
                } else {
                    console.warn("Received invalid details data payload. Keeping local state.");
                    if (data && data.statusUpdates) {
                        setStatusUpdates(data.statusUpdates);
                    }
                }
            } catch (err: any) {
                console.error('Error fetching complaint details:', err);
                setError(err.response?.data?.message || err.message || 'Error loading complaint details.');
            } finally {
                setLoading(false);
            }
        };

        if (complaint) {
            fetchDetails();
        }
    }, [complaint, role, userId, reloadTrigger]);

    // Auto-refresh details every 15s (catches status/image updates by admin)
    useEffect(() => {
        if (!complaint) return;
        const interval = setInterval(() => {
            setReloadTrigger(prev => prev + 1);
        }, 15000);
        return () => clearInterval(interval);
    }, [complaint]);

    // Determine progress state based on current latest status
    const getLatestStatus = () => {
        if (statusUpdates && statusUpdates.length > 0) {
            const sorted = [...statusUpdates].sort((a, b) => 
                new Date(a.createdAt || a.timestamp || 0).getTime() - new Date(b.createdAt || b.timestamp || 0).getTime()
            );
            return sorted[sorted.length - 1].workstatus || fullComplaint.status || 'Pending';
        }
        return fullComplaint.status || 'Pending';
    };

    const currentStatus = getLatestStatus().toLowerCase();
    const isWIP = currentStatus.includes('progress') || currentStatus.includes('work-on-progress') || currentStatus.includes('review') || currentStatus.includes('forward');
    const isCompleted = currentStatus.includes('complete') || currentStatus.includes('resolve');



    // Style helper for timeline badges
    const getBadgeStyle = (workstatus: string) => {
        const s = (workstatus || 'pending').toLowerCase();
        if (s.includes('progress') || s.includes('review') || s.includes('forward')) {
            return {
                bg: 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)',
                label: 'Work on Progress',
                icon: <WrenchIcon sx={{ color: '#ffffff', fontSize: '0.8rem' }} />
            };
        } else if (s.includes('complete') || s.includes('resolve')) {
            return {
                bg: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)',
                label: 'Completed',
                icon: <TickIcon sx={{ color: '#ffffff', fontSize: '0.8rem' }} />
            };
        }
        return {
            bg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
            label: 'Pending',
            icon: <ClockIcon sx={{ color: '#ffffff', fontSize: '0.8rem' }} />
        };
    };

    return (
        <Dialog
            open={!!complaint}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            scroll="body"
            sx={{
                '& .MuiDialog-paper': {
                    borderRadius: '5px',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, #2563eb 0%, #14b8a6 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                }
            }}
        >
            <DialogContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Box sx={{
                    p: { xs: 2.5, sm: 4 },
                    borderRadius: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    backdropFilter: 'blur(10px)',
                }}>
                    {/* Header bar */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <IconButton onClick={onClose} sx={{ color: '#0f172a' }}>
                                <ArrowBackIcon />
                            </IconButton>
                            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.025em' }}>
                                {role === 'admin' && activeTab === 1 ? 'Update Work Status' : 'Complaint Details'}
                            </Typography>
                        </Box>
                        <IconButton onClick={onClose} sx={{ color: '#475569', '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' } }}>
                            <CloseIcon />
                        </IconButton>
                    </Box>

                    {role === 'admin' && !isCompleted && (
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                            <Tabs 
                                value={activeTab} 
                                onChange={(e, newValue) => setActiveTab(newValue)}
                                textColor="primary"
                                indicatorColor="primary"
                                sx={{
                                    '& .MuiTab-root': {
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        fontSize: '0.9rem',
                                        color: '#64748b',
                                    },
                                    '& .Mui-selected': {
                                        color: '#2563eb !important',
                                    }
                                }}
                            >
                                <Tab label="Complaint Details" />
                                <Tab label="Update Work Status" />
                            </Tabs>
                        </Box>
                    )}

                    {role === 'admin' && activeTab === 1 && !isCompleted ? (
                        <UpdateStatus 
                            complaint={complaint} 
                            isInline={true} 
                            onClose={onClose}
                            onSuccess={() => {
                                setActiveTab(0);
                                setReloadTrigger(prev => prev + 1);
                            }}
                        />
                    ) : (
                        <>
                            {error && (
                                <Alert severity="error" sx={{ mb: 3, borderRadius: '6px' }}>
                                    {error}
                                </Alert>
                            )}

                            {loading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                                    <CircularProgress sx={{ color: '#14b8a6' }} />
                                </Box>
                            ) : (
                                <>
                            {/* Horizontal Progress Stepper */}
                            <Box sx={{ 
                                mb: 5, 
                                p: 3, 
                                backgroundColor: '#f8fafc', 
                                borderRadius: '8px', 
                                border: '1px solid #e2e8f0',
                                position: 'relative'
                            }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', px: { xs: 2, sm: 6 } }}>
                                    {/* Connection Line 1 */}
                                    <Box sx={{
                                        position: 'absolute',
                                        top: '20px',
                                        left: { xs: 'calc(16% + 20px)', sm: 'calc(16% + 30px)' },
                                        right: { xs: 'calc(50% + 10px)', sm: 'calc(50% + 20px)' },
                                        height: '4px',
                                        background: isWIP 
                                            ? 'linear-gradient(90deg, #ea580c 0%, #3b82f6 100%)' 
                                            : '#cbd5e1',
                                        zIndex: 1,
                                    }} />

                                    {/* Connection Line 2 */}
                                    <Box sx={{
                                        position: 'absolute',
                                        top: '20px',
                                        left: { xs: 'calc(50% + 10px)', sm: 'calc(50% + 20px)' },
                                        right: { xs: 'calc(16% + 20px)', sm: 'calc(16% + 30px)' },
                                        height: '4px',
                                        background: isCompleted 
                                            ? 'linear-gradient(90deg, #3b82f6 0%, #22c55e 100%)' 
                                            : '#cbd5e1',
                                        zIndex: 1,
                                    }} />

                                    {/* Step 1: Pending */}
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                                        <Box sx={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                                            boxShadow: '0 0 10px rgba(249, 115, 22, 0.4)',
                                            color: '#fff',
                                        }}>
                                            <ClockIcon sx={{ fontSize: '1.2rem' }} />
                                        </Box>
                                        <Typography variant="caption" sx={{ mt: 1, fontWeight: 700, color: '#ea580c' }}>
                                            Pending
                                        </Typography>
                                    </Box>

                                    {/* Step 2: Work on Progress */}
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                                        <Box sx={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: isWIP 
                                                ? 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)' 
                                                : '#cbd5e1',
                                            boxShadow: isWIP ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                                            color: '#fff',
                                        }}>
                                            <WrenchIcon sx={{ fontSize: '1.1rem' }} />
                                        </Box>
                                        <Typography variant="caption" sx={{ mt: 1, fontWeight: 700, color: isWIP ? '#2563eb' : '#64748b' }}>
                                            In Progress
                                        </Typography>
                                    </Box>

                                    {/* Step 3: Completed */}
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                                        <Box sx={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: isCompleted 
                                                ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' 
                                                : '#cbd5e1',
                                            boxShadow: isCompleted ? '0 0 10px rgba(34, 197, 94, 0.4)' : 'none',
                                            color: '#fff',
                                        }}>
                                            <TickIcon sx={{ fontSize: '1.2rem' }} />
                                        </Box>
                                        <Typography variant="caption" sx={{ mt: 1, fontWeight: 700, color: isCompleted ? '#16a34a' : '#64748b' }}>
                                            Completed
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>

                            {/* Core Details Grid */}
                            <Grid container spacing={3.5}>
                                {/* Left Side Map & Image */}
                                <Grid size={{ xs: 12, md: 6 }}>
                                    {(() => {
                                        const src = fullComplaint.photoUrl || fullComplaint.image || '';
                                        if (!src) return null;
                                        const displaySrc = (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:'))
                                            ? src
                                            : `/photo/${src}`;
                                        return (
                                            <Card sx={{ borderRadius: '6px', mb: 2.5, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                                                <CardMedia
                                                    component="img"
                                                    image={displaySrc}
                                                    alt={fullComplaint.title}
                                                    sx={{ maxHeight: '240px', width: '100%', objectFit: 'cover' }}
                                                />
                                            </Card>
                                        );
                                    })()}
                                    <ComplaintMap locationUrl={fullComplaint.locationUrl || fullComplaint.locationurl} height={220} minHeight={220} />
                                </Grid>

                                {/* Right Side Info Text */}
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                                        <Box>
                                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
                                                <Chip
                                                    label={fullComplaint.issueType || fullComplaint.issuetype || 'General'}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ borderColor: '#cbd5e1', color: '#475569', fontWeight: 600 }}
                                                />
                                                {/* Current Status Indicator */}
                                                <Chip
                                                    label={currentStatus === 'completed' ? 'Completed' : currentStatus === 'work-on-progress' ? 'Work on Progress' : 'Pending'}
                                                    size="small"
                                                    sx={{
                                                        background: isCompleted ? 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)' : isWIP ? 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)' : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                                                        color: '#ffffff',
                                                        fontWeight: 700
                                                    }}
                                                />
                                            </Box>
                                            {fullComplaint.id && (
                                                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', display: 'block', mb: 0.5 }}>
                                                    {fullComplaint.id}
                                                </Typography>
                                            )}
                                            <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a', mb: 2 }}>
                                                {fullComplaint.title}
                                            </Typography>

                                            <Divider sx={{ mb: 2 }} />

                                            {/* Citizen info + dates */}
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
                                                {fullComplaint.citizenName && (
                                                    <Box>
                                                        <Typography variant="caption" color="#94a3b8" sx={{ fontWeight: 600 }}>Filed by</Typography>
                                                        <Typography variant="body2" color="#0f172a" sx={{ fontWeight: 700 }}>{fullComplaint.citizenName}</Typography>
                                                    </Box>
                                                )}
                                                {role !== 'citizen' && fullComplaint.citizenPhone && (
                                                    <Box>
                                                        <Typography variant="caption" color="#94a3b8" sx={{ fontWeight: 600 }}>Phone</Typography>
                                                        <Typography variant="body2" color="#0f172a" sx={{ fontWeight: 700 }}>{fullComplaint.citizenPhone}</Typography>
                                                    </Box>
                                                )}
                                                {fullComplaint.createdAt && (
                                                    <Box>
                                                        <Typography variant="caption" color="#94a3b8" sx={{ fontWeight: 600 }}>Registered</Typography>
                                                        <Typography variant="body2" color="#0f172a" sx={{ fontWeight: 700 }}>{fullComplaint.createdAt}</Typography>
                                                    </Box>
                                                )}
                                                {fullComplaint.forwardedTo && (
                                                    <Box>
                                                        <Typography variant="caption" color="#94a3b8" sx={{ fontWeight: 600 }}>Forwarded to</Typography>
                                                        <Typography variant="body2" color="#0f172a" sx={{ fontWeight: 700 }}>{fullComplaint.forwardedTo}</Typography>
                                                    </Box>
                                                )}
                                            </Box>

                                            <Typography variant="body2" color="#64748b" sx={{ fontWeight: 600, mb: 0.5 }}>
                                                Description
                                            </Typography>
                                            <Typography variant="body1" color="#334155" sx={{ mb: 4, lineHeight: 1.6, lineBreak: 'anywhere' }}>
                                                {fullComplaint.description}
                                            </Typography>
                                        </Box>

                                        {/* Action buttons */}
                                        <Box sx={{ display: 'flex', gap: 2, mt: 'auto' }}>
                                            <Button
                                                variant="outlined"
                                                onClick={onClose}
                                                fullWidth
                                                sx={{
                                                    borderColor: '#cbd5e1',
                                                    color: '#475569',
                                                    textTransform: 'none',
                                                    fontWeight: 700,
                                                    borderRadius: '6px',
                                                    py: 1.2,
                                                    '&:hover': {
                                                        borderColor: '#94a3b8',
                                                        backgroundColor: '#f1f5f9'
                                                    }
                                                }}
                                            >
                                                Dashboard
                                            </Button>
                                            {role === 'admin' && !isCompleted && (
                                                <Button
                                                    variant="contained"
                                                    startIcon={<EditIcon />}
                                                    onClick={() => setActiveTab(1)}
                                                    fullWidth
                                                    sx={{
                                                        backgroundColor: '#0f172a',
                                                        color: '#ffffff',
                                                        textTransform: 'none',
                                                        fontWeight: 700,
                                                        borderRadius: '6px',
                                                        py: 1.2,
                                                        '&:hover': {
                                                            backgroundColor: '#1e293b'
                                                        }
                                                    }}
                                                >
                                                    Update Status
                                                </Button>
                                            )}
                                        </Box>
                                    </Box>
                                </Grid>
                            </Grid>

                            {/* Timeline section */}
                            {statusUpdates && statusUpdates.length > 0 && (
                                <Box sx={{ mt: 6 }}>
                                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', mb: 3 }}>
                                        Work / Progress History
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {statusUpdates.map((update, idx) => {
                                            const badgeInfo = getBadgeStyle(update.workstatus);
                                            return (
                                                <Card key={update.id || update._id || idx} sx={{ 
                                                    borderRadius: '6px', 
                                                    border: '1px solid #e2e8f0', 
                                                    boxShadow: 'none',
                                                    backgroundColor: '#f8fafc',
                                                    position: 'relative',
                                                    '&::before': {
                                                        content: '""',
                                                        position: 'absolute',
                                                        left: 0,
                                                        top: 0,
                                                        bottom: 0,
                                                        width: '4px',
                                                        background: badgeInfo.bg
                                                    }
                                                }}>
                                                    <CardContent sx={{ p: 2.5 }}>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                                                            <Box>
                                                                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0f172a' }}>
                                                                    {update.title}
                                                                </Typography>
                                                                {update.dateTime && (
                                                                    <Typography variant="caption" color="#94a3b8">
                                                                        Updated at: {update.dateTime}
                                                                    </Typography>
                                                                )}
                                                            </Box>
                                                            <Chip 
                                                                icon={badgeInfo.icon}
                                                                label={badgeInfo.label} 
                                                                size="small"
                                                                sx={{ 
                                                                    background: badgeInfo.bg,
                                                                    color: '#ffffff',
                                                                    fontWeight: 700,
                                                                    fontSize: '0.7rem',
                                                                    '& .MuiChip-icon': { color: '#ffffff' }
                                                                }}
                                                            />
                                                        </Box>
                                                        
                                                        <Typography variant="body2" color="#475569" sx={{ mb: 2, lineBreak: 'anywhere' }}>
                                                            {update.description}
                                                        </Typography>

                                                        {update.photoUrl && (
                                                            <Box sx={{ mt: 1.5, maxWidth: '280px', borderRadius: '4px', overflow: 'hidden' }}>
                                                                <img 
                                                                    src={`/photo/${update.photoUrl}`} 
                                                                    alt={update.title} 
                                                                    style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', display: 'block' }}
                                                                />
                                                            </Box>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            );
                                        })}
                                    </Box>
                                </Box>
                            )}
                        </>
                    )}
                    </>
                    )}
                </Box>
            </DialogContent>
        </Dialog>
    );
}
