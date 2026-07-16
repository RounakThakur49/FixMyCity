import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import type { RootState } from '../../reducers';
import { fetchAdminHomeRequest } from '../../actions/admin.slice';
import UpdateStatus from './updateStatus';
import ComplaintDetails from './complaintDetails';
import ComplaintMap from './complaintMap';
import {
    Box,
    Typography,
    Card,
    CardContent,
    CardMedia,
    Button,
    Grid,
    Chip,
    CircularProgress,
    Container,
    Alert,
    Skeleton,
    Paper,
    TextField,
    InputAdornment
} from '@mui/material';
import {
    Visibility,
    Edit,
    AccessTime as ClockIcon,
    Build as WrenchIcon,
    CheckCircle as TickIcon,
    Search as SearchIcon
} from '@mui/icons-material';
import backgroundImage from '../../assets/background1.jpg';

export default function AdminHome() {
    const dispatch = useAppDispatch();
    const { user } = useSelector((state: RootState) => state.auth);
    const { loading, error, complaints, statusMap } = useSelector((state: RootState) => state.admin);
    const [updatingComplaint, setUpdatingComplaint] = React.useState<any | null>(null);
    const [selectedComplaint, setSelectedComplaint] = React.useState<any | null>(null);
    const [hoveredComplaint, setHoveredComplaint] = React.useState<any | null>(null);
    const [statusFilter, setStatusFilter] = React.useState<'all' | 'pending' | 'progress' | 'completed'>('all');
    const [searchQuery, setSearchQuery] = React.useState('');

    const getComplaintStatusGroup = React.useCallback((complaint: any) => {
        const latest = statusMap && statusMap[complaint.id || complaint._id];
        const rawStatus = (latest ? latest.workstatus : (complaint.status || 'pending')).toLowerCase();
        if (rawStatus.includes('progress') || rawStatus.includes('work-on-progress') || rawStatus.includes('review') || rawStatus.includes('forward')) {
            return 'progress';
        } else if (rawStatus.includes('complete') || rawStatus.includes('resolve')) {
            return 'completed';
        }
        return 'pending';
    }, [statusMap]);

    const sortedComplaints = React.useMemo(() => {
        return [...complaints].reverse();
    }, [complaints]);

    const filteredComplaints = React.useMemo(() => {
        let result = sortedComplaints;
        if (statusFilter !== 'all') {
            result = result.filter(c => getComplaintStatusGroup(c) === statusFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            result = result.filter(c =>
                (c.id || '').toLowerCase().includes(q) ||
                (c.title || '').toLowerCase().includes(q) ||
                (c.description || '').toLowerCase().includes(q) ||
                (c.issueType || c.issuetype || c.type || '').toLowerCase().includes(q) ||
                (c.citizenName || '').toLowerCase().includes(q)
            );
        }
        return result;
    }, [sortedComplaints, statusFilter, searchQuery, getComplaintStatusGroup]);

    const counts = React.useMemo(() => {
        let pending = 0;
        let progress = 0;
        let completed = 0;
        
        complaints.forEach((complaint: any) => {
            const latest = statusMap && statusMap[complaint.id || complaint._id];
            const rawStatus = (latest ? latest.workstatus : (complaint.status || 'pending')).toLowerCase();
            
            if (rawStatus.includes('progress') || rawStatus.includes('work-on-progress') || rawStatus.includes('review') || rawStatus.includes('forward')) {
                progress++;
            } else if (rawStatus.includes('complete') || rawStatus.includes('resolve')) {
                completed++;
            } else {
                pending++;
            }
        });
        
        return { pending, progress, completed, total: complaints.length };
    }, [complaints, statusMap]);

    // Retrieve userId and role from logged-in user state
    const loginUserObj = user as any;
    const userId = loginUserObj?.user?.id || loginUserObj?.id || '';
    const role   = loginUserObj?.user?.role || loginUserObj?.role || 'admin';

    useEffect(() => {
        if (userId) {
            dispatch(fetchAdminHomeRequest({ userId, role }));
        }
    }, [userId, role, dispatch]);

    // Auto-sync every 15s — silently refreshes without spinner.
    // Pauses when a dialog (details/update) is open.
    useEffect(() => {
        if (!userId) return;
        const interval = setInterval(() => {
            if (!selectedComplaint && !updatingComplaint) {
                dispatch(fetchAdminHomeRequest({ userId, role }));
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [userId, role, dispatch, selectedComplaint, updatingComplaint]);



    const getStatusBadge = (complaintId: string, defaultStatus: string) => {
        const latest = statusMap && statusMap[complaintId];
        const rawStatus = (latest ? latest.workstatus : (defaultStatus || 'pending')).toLowerCase();
        
        let label = 'Pending';
        let bgStyle = 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'; // Orange
        let icon = <ClockIcon sx={{ color: '#ffffff', fontSize: '0.9rem' }} />;
        
        if (rawStatus.includes('progress') || rawStatus.includes('work-on-progress')) {
            label = latest ? latest.workstatus : 'Work on Progress';
            bgStyle = 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)'; // Blue and Yellow Gradient
            icon = <WrenchIcon sx={{ color: '#ffffff', fontSize: '0.9rem' }} />;
        } else if (rawStatus.includes('complete') || rawStatus.includes('resolve')) {
            label = latest ? latest.workstatus : 'Completed';
            bgStyle = 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'; // Green
            icon = <TickIcon sx={{ color: '#ffffff', fontSize: '0.9rem' }} />;
        }
        
        return (
            <Chip 
                icon={icon}
                label={label} 
                sx={{
                    background: bgStyle,
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    '& .MuiChip-icon': {
                        color: '#ffffff',
                        marginLeft: '8px',
                        marginRight: '-4px'
                    }
                }}
                size="small" 
            />
        );
    };



    return (
        <Box sx={{
            position: 'relative',
            minHeight: 'calc(100vh - 100px)',
            py: 4,
            overflow: 'hidden',
            '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                backgroundColor: '#e6eef0',
                backgroundImage:
                    'radial-gradient(rgba(15,118,110,0.06) 1px, transparent 1px),' +
                    'radial-gradient(1100px 720px at 88% -8%, rgba(20,184,166,0.22), transparent 60%),' +
                    'radial-gradient(1000px 640px at -8% 112%, rgba(37,99,235,0.16), transparent 58%)',
                backgroundSize: '22px 22px, 100% 100%, 100% 100%',
                pointerEvents: 'none',
                zIndex: -1,
            }
        }}>
            <Container maxWidth="xl">
            {/* Header section */}
            <Box sx={{ mb: 4 }}>
                    <Typography variant="h4" sx={{ fontWeight: 700, color: '#1e293b' }}>
                        {role === 'superadmin' ? 'SuperAdmin Control Panel' : 'Admin Control Panel'}
                    </Typography>
                <Typography variant="subtitle1" color="#64748b">
                    Welcome back, {loginUserObj?.user?.name || (role === 'superadmin' ? 'SuperAdmin' : 'Admin')}! Manage complaints, view photos, and update work status.
                </Typography>
            </Box>

            {loading && (
                <Grid container spacing={3}>
                    {Array.from(new Array(4)).map((_, index) => (
                        <Grid size={{ xs: 12, md: 6 }} key={index}>
                            <Card sx={{ display: 'flex', height: '100%', borderRadius: 3, boxShadow: 'none', border: '1px solid #cbd5e1' }}>
                                <Skeleton variant="rectangular" width={140} height="100%" sx={{ display: { xs: 'none', sm: 'block' } }} />
                                <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: 2 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                        <Skeleton variant="rectangular" width={80} height={20} sx={{ borderRadius: 1 }} />
                                        <Skeleton variant="rectangular" width={60} height={20} sx={{ borderRadius: 1 }} />
                                    </Box>
                                    <Skeleton variant="text" width="60%" height={28} />
                                    <Skeleton variant="text" width="90%" height={20} sx={{ mt: 1 }} />
                                    <Skeleton variant="text" width="80%" height={20} />
                                    <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                                        <Skeleton variant="rectangular" width={80} height={30} sx={{ borderRadius: 1 }} />
                                        <Skeleton variant="rectangular" width={110} height={30} sx={{ borderRadius: 1 }} />
                                    </Box>
                                </Box>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {error && (
                <Alert severity="error" sx={{ mb: 4 }}>
                    {error}
                </Alert>
            )}

            {!loading && !error && complaints.length === 0 && (
                <Box sx={{ py: 8, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 4, border: '1px dashed #cbd5e1' }}>
                    <Typography variant="h6" color="#64748b">
                        No registered complaints found.
                    </Typography>
                    <Typography color="#94a3b8" variant="body2" sx={{ mt: 1 }}>
                        All citizen registered complaints will show up here.
                    </Typography>
                </Box>
            )}

            {!loading && !error && complaints.length > 0 && (
                <Paper 
                    elevation={0}
                    sx={{
                        p: 3,
                        borderRadius: '20px',
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 15px 35px rgba(0,0,0,0.08)',
                        height: 'calc(100vh - 240px)',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Frame Header */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{
                                width: 8,
                                height: 26,
                                borderRadius: 1,
                                backgroundColor: '#14b8a6'
                            }} />
                            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                                Complaints Operations Control
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                                label={`${counts.total} Active`}
                                size="small"
                                onClick={() => setStatusFilter('all')}
                                sx={{
                                    backgroundColor: statusFilter === 'all' ? '#0f172a' : 'rgba(15, 23, 42, 0.08)',
                                    color: statusFilter === 'all' ? '#ffffff' : '#0f172a',
                                    fontWeight: 700,
                                    fontSize: '0.75rem',
                                    border: statusFilter === 'all' ? 'none' : '1px solid rgba(15, 23, 42, 0.1)',
                                    px: 0.5,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    '&:hover': { opacity: 0.85 }
                                }}
                            />
                            <Chip
                                label={`${counts.pending} Pending`}
                                size="small"
                                onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                                sx={{
                                    background: statusFilter === 'pending'
                                        ? 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
                                        : 'rgba(249, 115, 22, 0.12)',
                                    color: statusFilter === 'pending' ? '#ffffff' : '#ea580c',
                                    fontWeight: 700,
                                    fontSize: '0.75rem',
                                    px: 0.5,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    boxShadow: statusFilter === 'pending' ? '0 2px 6px rgba(234, 88, 12, 0.25)' : 'none',
                                    '&:hover': { opacity: 0.85 }
                                }}
                            />
                            <Chip
                                label={`${counts.progress} Progress`}
                                size="small"
                                onClick={() => setStatusFilter(statusFilter === 'progress' ? 'all' : 'progress')}
                                sx={{
                                    background: statusFilter === 'progress'
                                        ? 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)'
                                        : 'rgba(59, 130, 246, 0.12)',
                                    color: statusFilter === 'progress' ? '#ffffff' : '#3b82f6',
                                    fontWeight: 700,
                                    fontSize: '0.75rem',
                                    px: 0.5,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    boxShadow: statusFilter === 'progress' ? '0 2px 6px rgba(59, 130, 246, 0.25)' : 'none',
                                    '&:hover': { opacity: 0.85 }
                                }}
                            />
                            <Chip
                                label={`${counts.completed} Completed`}
                                size="small"
                                onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')}
                                sx={{
                                    background: statusFilter === 'completed'
                                        ? 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'
                                        : 'rgba(34, 197, 94, 0.12)',
                                    color: statusFilter === 'completed' ? '#ffffff' : '#15803d',
                                    fontWeight: 700,
                                    fontSize: '0.75rem',
                                    px: 0.5,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    boxShadow: statusFilter === 'completed' ? '0 2px 6px rgba(34, 197, 94, 0.25)' : 'none',
                                    '&:hover': { opacity: 0.85 }
                                }}
                            />
                        </Box>
                    </Box>

                    {/* Search Bar */}
                    <Box sx={{ mb: 2 }}>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Search by complaint ID, title, description, category, or citizen name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            slotProps={{
                                input: {
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon sx={{ color: '#94a3b8', fontSize: '1.2rem' }} />
                                        </InputAdornment>
                                    ),
                                }
                            }}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '12px',
                                    backgroundColor: '#f8fafc',
                                    fontSize: '0.85rem',
                                    '& fieldset': { borderColor: '#e2e8f0' },
                                    '&:hover fieldset': { borderColor: '#14b8a6' },
                                    '&.Mui-focused fieldset': { borderColor: '#14b8a6' },
                                }
                            }}
                        />
                        {(statusFilter !== 'all' || searchQuery.trim()) && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                                <Typography variant="caption" sx={{ color: '#64748b' }}>
                                    Showing {filteredComplaints.length} of {complaints.length} complaints
                                </Typography>
                                <Chip
                                    label="Clear filters"
                                    size="small"
                                    onClick={() => { setStatusFilter('all'); setSearchQuery(''); }}
                                    sx={{
                                        height: 22,
                                        fontSize: '0.7rem',
                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                        color: '#ef4444',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        '&:hover': { backgroundColor: 'rgba(239, 68, 68, 0.2)' }
                                    }}
                                />
                            </Box>
                        )}
                    </Box>

                    <Grid container spacing={4} sx={{ flex: 1, minHeight: 0 }}>
                        {/* Left Column - Fixed Map */}
                        <Grid size={{ xs: 12, md: 5, lg: 5 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <Box sx={{
                                flex: 1,
                                borderRadius: '12px',
                                overflow: 'hidden',
                                border: '1px solid #cbd5e1',
                                position: 'relative',
                                backgroundColor: '#ffffff',
                                height: '100%'
                            }}>
                            <ComplaintMap
                                locationUrl={hoveredComplaint?.locationUrl || hoveredComplaint?.locationurl}
                                complaintsList={filteredComplaints}
                            />
                            {hoveredComplaint && (
                                <Box sx={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: 'linear-gradient(to top, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.7) 70%, rgba(15, 23, 42, 0) 100%)',
                                    color: '#ffffff',
                                    p: 3,
                                    pt: 6,
                                    pointerEvents: 'none'
                                }}>
                                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1 }}>
                                        <Chip 
                                            label={hoveredComplaint.issueType || hoveredComplaint.issuetype || 'General'} 
                                            size="small" 
                                            sx={{ 
                                                backgroundColor: 'rgba(255, 255, 255, 0.2)', 
                                                color: '#ffffff', 
                                                fontWeight: 600,
                                                backdropFilter: 'blur(4px)'
                                            }} 
                                        />
                                        <Chip 
                                            label={(hoveredComplaint.status || 'Pending').toLowerCase().includes('progress') ? 'Work on Progress' : (hoveredComplaint.status || 'Pending').toLowerCase().includes('complete') ? 'Completed' : 'Pending'}
                                            size="small"
                                            sx={{
                                                background: (hoveredComplaint.status || 'Pending').toLowerCase().includes('complete') 
                                                    ? 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)' 
                                                    : (hoveredComplaint.status || 'Pending').toLowerCase().includes('progress') 
                                                        ? 'linear-gradient(135deg, #3b82f6 0%, #eab308 100%)' 
                                                        : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                                                color: '#ffffff',
                                                fontWeight: 700
                                            }}
                                        />
                                    </Box>
                                    <Typography variant="h5" sx={{ fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                        {hoveredComplaint.title}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                        {hoveredComplaint.description}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Grid>

                    {/* Right Column - Scrollable Complaints List */}
                    <Grid size={{ xs: 12, md: 7, lg: 7 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box 
                            onMouseLeave={() => setHoveredComplaint(null)}
                            sx={{ 
                                flex: 1,
                                overflowY: 'auto',
                                pr: { xs: 0, md: 1 },
                                height: '100%',
                                '&::-webkit-scrollbar': {
                                    width: '6px'
                                },
                                '&::-webkit-scrollbar-track': {
                                    background: 'transparent'
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    background: '#cbd5e1',
                                    borderRadius: '3px'
                                },
                                '&::-webkit-scrollbar-thumb:hover': {
                                    background: '#94a3b8'
                                }
                            }}
                        >
                            <Grid container spacing={2}>
                                {filteredComplaints.length === 0 ? (
                                    <Grid size={{ xs: 12 }}>
                                        <Box sx={{ py: 6, textAlign: 'center' }}>
                                            <Typography variant="body1" color="#94a3b8" sx={{ fontWeight: 600 }}>
                                                No complaints match your filters.
                                            </Typography>
                                            <Typography variant="body2" color="#cbd5e1" sx={{ mt: 0.5 }}>
                                                Try adjusting your search or status filter.
                                            </Typography>
                                        </Box>
                                    </Grid>
                                ) : filteredComplaints.map((complaint: any) => {
                                    const isCurrentlyHovered = hoveredComplaint?.id === complaint.id || hoveredComplaint?._id === complaint._id;
                                    const latest = statusMap && statusMap[complaint.id || complaint._id];
                                    const rawStatus = (latest ? latest.workstatus : (complaint.status || 'pending')).toLowerCase();
                                    const isCompleted = rawStatus.includes('complete') || rawStatus.includes('resolve');
                                    return (
                                        <Grid size={{ xs: 12, sm: 6 }} key={complaint.id || complaint._id}>
                                            <Card 
                                                onMouseEnter={() => setHoveredComplaint(complaint)}
                                                sx={{ 
                                                    display: 'flex', 
                                                    flexDirection: 'column',
                                                    height: '100%',
                                                    boxShadow: isCurrentlyHovered 
                                                        ? '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' 
                                                        : '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                                                    borderRadius: 3,
                                                    border: isCurrentlyHovered ? '2px solid #14b8a6' : '2px solid transparent',
                                                    transform: isCurrentlyHovered ? 'translateY(-2px)' : 'none',
                                                    transition: 'all 0.2s ease',
                                                    '&:hover': {
                                                        borderColor: '#14b8a6'
                                                    }
                                                }}
                                            >
                                                {complaint.photoUrl && (
                                                    <CardMedia
                                                        component="img"
                                                        sx={{ height: 140, width: '100%', objectFit: 'cover' }}
                                                        image={(complaint.photoUrl.startsWith('data:') || complaint.photoUrl.startsWith('http') || complaint.photoUrl.startsWith('blob:')) ? complaint.photoUrl : `/photo/${complaint.photoUrl}`}
                                                        alt={complaint.title}
                                                    />
                                                )}
                                                <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                                    <CardContent sx={{ flex: '1 0 auto', p: 2 }}>
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 1 }}>
                                                            <Chip
                                                                label={complaint.issueType || complaint.issuetype || 'General'}
                                                                size="small"
                                                                variant="outlined"
                                                                sx={{ borderColor: '#cbd5e1', color: '#475569', fontWeight: 600, fontSize: '0.7rem' }}
                                                            />
                                                            {getStatusBadge(complaint.id, complaint.status)}
                                                        </Box>
                                                        {(complaint.id || complaint.citizenName) && (
                                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                                                {complaint.id && (
                                                                    <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.05em' }}>
                                                                        {complaint.id}
                                                                    </Typography>
                                                                )}
                                                                {complaint.citizenName && (
                                                                    <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600, fontSize: '0.65rem' }}>
                                                                        by {complaint.citizenName}
                                                                    </Typography>
                                                                )}
                                                            </Box>
                                                        )}
                                                        <Typography component="div" variant="subtitle1" noWrap sx={{ fontWeight: 700, color: '#0f172a' }}>
                                                            {complaint.title}
                                                        </Typography>
                                                        <Typography
                                                            variant="body2"
                                                            color="#475569"
                                                            sx={{
                                                                mt: 1,
                                                                lineBreak: 'anywhere',
                                                                display: '-webkit-box',
                                                                WebkitLineClamp: 2,
                                                                WebkitBoxOrient: 'vertical',
                                                                overflow: 'hidden',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >
                                                            {complaint.description}
                                                        </Typography>
                                                    </CardContent>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pb: 2 }}>
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            startIcon={<Visibility />}
                                                            sx={{
                                                                textTransform: 'none',
                                                                borderColor: '#14b8a6',
                                                                color: '#14b8a6',
                                                                fontWeight: 600,
                                                                fontSize: '0.75rem',
                                                                '&:hover': {
                                                                    borderColor: '#0d9488',
                                                                    backgroundColor: 'rgba(20, 184, 166, 0.04)',
                                                                }
                                                            }}
                                                            onClick={() => {
                                                                const latest = statusMap && statusMap[complaint.id || complaint._id];
                                                                const status = latest ? latest.workstatus : (complaint.status || 'Pending');
                                                                setSelectedComplaint({ ...complaint, status });
                                                            }}
                                                        >
                                                            Details
                                                        </Button>
                                                        {!isCompleted && role !== 'superadmin' && (
                                                            <Button
                                                                variant="contained"
                                                                size="small"
                                                                startIcon={<Edit />}
                                                                sx={{
                                                                    textTransform: 'none',
                                                                    backgroundColor: '#0f172a',
                                                                    color: '#ffffff',
                                                                    fontWeight: 600,
                                                                    fontSize: '0.75rem',
                                                                    '&:hover': {
                                                                        backgroundColor: '#1e293b',
                                                                    }
                                                                }}
                                                                onClick={() => {
                                                                    setUpdatingComplaint(complaint);
                                                                }}
                                                            >
                                                                Update
                                                            </Button>
                                                        )}
                                                    </Box>
                                                </Box>
                                            </Card>
                                        </Grid>
                                    );
                                })}
                            </Grid>
                        </Box>
                    </Grid>
                </Grid>
                </Paper>
            )}
            {updatingComplaint && (
                <UpdateStatus 
                    complaint={updatingComplaint} 
                    onClose={() => setUpdatingComplaint(null)} 
                />
            )}
            {selectedComplaint && (
                <ComplaintDetails 
                    complaint={selectedComplaint} 
                    role="admin"
                    userId={userId}
                    onClose={() => setSelectedComplaint(null)} 
                    onUpdateStatus={(comp) => {
                        setSelectedComplaint(null);
                        setUpdatingComplaint(comp);
                    }}
                />
            )}
            </Container>
        </Box>
    );
}

