import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { apiBaseFMCClient } from '../../apis/axios.baseClient';
import type { RootState } from '../../reducers';
import {
    Box,
    Typography,
    Container,
    Grid,
    Card,
    CardContent,
    Tabs,
    Tab,
    Button,
    Avatar,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Alert,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    ListItemAvatar,
    Divider,
    Paper
} from '@mui/material';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import HistoryIcon from '@mui/icons-material/History';
import DeleteIcon from '@mui/icons-material/Delete';
import BlockIcon from '@mui/icons-material/Block';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CategoryIcon from '@mui/icons-material/Category';
import BarChartIcon from '@mui/icons-material/BarChart';
import ComplaintMap from './complaintMap';
import bgImage from '../../assets/background1.jpg';

interface UserItem {
    id: string;
    name: string;
    email: string;
    mobile: string;
    location: string;
}

interface ActivityItem {
    title: string;
    description: string;
    dateTime: string;
}

interface StatsData {
    registered: number;
    pending: number;
    progress: number;
    completed: number;
    maxLocation: string;
    longestPending: string;
    maxCategory: string;
}

export default function Useage() {
    const { user } = useSelector((state: RootState) => state.auth);
    const loginUserObj = user as any;
    // Handle both JWT response shapes
    const authId   = loginUserObj?.user?.id   || loginUserObj?.id   || '';
    const authRole = loginUserObj?.user?.role || loginUserObj?.role || '';

    const [stats, setStats] = useState<StatsData | null>(null);
    const [admins, setAdmins] = useState<UserItem[]>([]);
    const [citizens, setCitizens] = useState<UserItem[]>([]);
    const [activeTab, setActiveTab] = useState(0);
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Activity modal state
    const [activityOpen, setActivityOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
    const [selectedUserRole, setSelectedUserRole] = useState<'admin' | 'citizen'>('admin');
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    // Create admin dialog state
    const [createAdminOpen, setCreateAdminOpen] = useState(false);
    const [createAdminLoading, setCreateAdminLoading] = useState(false);
    const [createAdminError, setCreateAdminError] = useState<string | null>(null);
    const [createAdminForm, setCreateAdminForm] = useState({
        name: '', username: '', email: '', phone: '', password: ''
    });
    const [showCreateAdminPassword, setShowCreateAdminPassword] = useState(false);

    // apiBaseFMCClient auto-attaches Bearer JWT via interceptor — no manual header needed

    const fetchData = async (silent = false) => {
        try {
            if (!silent) {
                setLoadingStats(true);
                setLoadingUsers(true);
            }
            setError(null);

            // Parallel fetch: stats + admins + citizens
            const [statsRes, adminsRes, citizensRes] = await Promise.all([
                apiBaseFMCClient.get('/api/superadmin/stats'),
                apiBaseFMCClient.get('/api/superadmin/admins'),
                apiBaseFMCClient.get('/api/superadmin/citizens?limit=100'),
            ]);

            const s = statsRes.data;
            setStats({
                registered:     s.registered     || 0,
                pending:        s.pending        || 0,
                progress:       (s.inReview || 0) + (s.forwarded || 0),
                completed:      s.completed      || 0,
                maxLocation:    s.maxLocation    || 'N/A',
                longestPending: s.longestPending || 'N/A',
                maxCategory:    s.maxCategory    || 'N/A',
            });

            setAdmins((adminsRes.data.admins || []).map((a: any) => ({
                id:       a.id,
                name:     a.name,
                email:    a.email    || '',
                mobile:   a.phone    || '',
                location: '',
            })));
            setCitizens((citizensRes.data.citizens || []).map((c: any) => ({
                id:       c.id,
                name:     c.name,
                email:    c.email    || '',
                mobile:   c.mobile   || c.phone || '',
                location: c.location || '',
            })));
        } catch (err: any) {
            console.error('Error fetching superadmin dashboard:', err);
            setError(err.response?.data?.message || err.message || 'Error loading dashboard statistics.');
        } finally {
            setLoadingStats(false);
            setLoadingUsers(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [authId, authRole]);

    // Auto-sync every 15s — refresh stats + user lists silently
    useEffect(() => {
        const interval = setInterval(() => {
            if (!activityOpen && !createAdminOpen) {
                fetchData(true);
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [authId, authRole, activityOpen, createAdminOpen]);

    const handleOpenActivity = async (targetUser: UserItem, role: 'admin' | 'citizen') => {
        setSelectedUser(targetUser);
        setSelectedUserRole(role);
        setActivityOpen(true);
        setLoadingActivities(true);
        setActionError(null);
        setActivities([]);

        try {
            if (role === 'citizen') {
                const res = await apiBaseFMCClient.get(
                    `/api/superadmin/citizens/${targetUser.id}/activity`
                );
                const data = res.data;
                setActivities((data.activity || []).map((a: any) => ({
                    title:       a.title       || a.type || 'Complaint',
                    description: a.description || a.status || '',
                    dateTime:    a.dateTime    || a.updatedAt || a.createdAt || '',
                })));
            } else {
                // Admin activity
                const res = await apiBaseFMCClient.get(
                    `/api/superadmin/admins/${targetUser.id}/activity`
                );
                const data = res.data;
                setActivities((data.activity || []).map((a: any) => ({
                    title:       a.title       || 'Status update',
                    description: a.description || '',
                    dateTime:    a.dateTime    || '',
                })));
            }
        } catch (err: any) {
            console.error('Error fetching activities:', err);
            setActionError('Failed to load activity list.');
        } finally {
            setLoadingActivities(false);
        }
    };

    const handleDeleteAdmin = async (adminId: string) => {
        if (!window.confirm('Are you sure you want to delete this admin account? This action is permanent.')) {
            return;
        }

        setActionLoading(true);
        setActionError(null);
        try {
            await apiBaseFMCClient.delete(`/api/superadmin/admins/${adminId}`);
            setActivityOpen(false);
            fetchData();
        } catch (err: any) {
            console.error('Failed to delete admin:', err);
            setActionError(err.response?.data?.message || 'Failed to delete admin.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleBlockCitizen = async (citizenId: string) => {
        if (!window.confirm('Block this citizen? This will permanently delete their account.')) {
            return;
        }

        setActionLoading(true);
        setActionError(null);
        try {
            // Block = delete citizen account (feature stub — not yet in backend)
            // For now, close dialog and show a message
            setActivityOpen(false);
            setActionError('Citizen blocking is not yet implemented.');
        } catch (err: any) {
            console.error('Failed to block citizen:', err);
            setActionError(err.response?.data?.message || 'Failed to block citizen.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreateAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateAdminLoading(true);
        setCreateAdminError(null);
        try {
            await apiBaseFMCClient.post('/api/superadmin/admins', createAdminForm);
            setCreateAdminOpen(false);
            setCreateAdminForm({ name: '', username: '', email: '', phone: '', password: '' });
            fetchData();
        } catch (err: any) {
            setCreateAdminError(err.response?.data?.message || 'Failed to create admin.');
        } finally {
            setCreateAdminLoading(false);
        }
    };

    // Calculate maximum count to scale bar graph
    const maxVal = stats ? Math.max(stats.registered, stats.pending, stats.progress, stats.completed, 1) : 1;

    return (
        <Box sx={{
            py: 4,
            minHeight: 'calc(100vh - 100px)',
            backgroundColor: '#e6eef0',
            backgroundImage:
                'radial-gradient(rgba(15,118,110,0.06) 1px, transparent 1px),' +
                'radial-gradient(1100px 720px at 88% -8%, rgba(20,184,166,0.22), transparent 60%),' +
                'radial-gradient(1000px 640px at -8% 112%, rgba(37,99,235,0.16), transparent 58%)',
            backgroundSize: '22px 22px, 100% 100%, 100% 100%',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
            backgroundRepeat: 'no-repeat'
        }}>
            <Container maxWidth="xl">
                {/* Header */}
                <Box sx={{ mb: 4 }}>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.025em' }}>
                        System Usage & User Management
                    </Typography>
                    <Typography variant="subtitle1" color="#64748b">
                        Super Admin control panel for monitoring statistics, reviewing system activity, and managing accounts.
                    </Typography>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 4, borderRadius: '8px' }}>
                        {error}
                    </Alert>
                )}

                <Grid container spacing={4}>
                    {/* Left Panel: Statistics and Custom Bar Graph */}
                    <Grid size={{ xs: 12, lg: 5 }}>
                        <Card sx={{
                            borderRadius: '16px',
                            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05)',
                            border: '1px solid #e2e8f0',
                            height: '680px',
                            backgroundColor: '#ffffff',
                            display: 'flex',
                            flexDirection: 'column'
                        }}>
                            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                                    <BarChartIcon sx={{ color: '#2563eb' }} />
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                                        Complaints Analytics
                                    </Typography>
                                </Box>

                                {loadingStats || !stats ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                                        <CircularProgress sx={{ color: '#2563eb' }} />
                                    </Box>
                                ) : (
                                    <>
                                        {/* Custom Vertical Bar Graph */}
                                        <Box sx={{ p: 2, backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #f1f5f9', mb: 2.5 }}>
                                            <Box sx={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-around', 
                                                alignItems: 'flex-end', 
                                                height: '130px', 
                                                borderBottom: '2px solid #e2e8f0',
                                                pb: 1
                                            }}>
                                                {[
                                                    { label: 'Registered', count: stats.registered, color: '#0f172a' },
                                                    { label: 'Pending', count: stats.pending, color: '#f97316' },
                                                    { label: 'In Progress', count: stats.progress, color: '#2563eb' },
                                                    { label: 'Completed', count: stats.completed, color: '#10b981' }
                                                ].map((item, idx) => {
                                                    const barHeight = maxVal > 0 ? `${(item.count / maxVal) * 90}px` : '4px';
                                                    return (
                                                        <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '22%' }}>
                                                            <Typography variant="caption" sx={{ fontWeight: 800, color: item.color, mb: 0.5, fontSize: '0.75rem' }}>
                                                                {item.count}
                                                            </Typography>
                                                            <Box sx={{ 
                                                                width: '100%', 
                                                                maxWidth: '32px', 
                                                                height: barHeight, 
                                                                backgroundColor: item.color, 
                                                                borderRadius: '4px 4px 0 0',
                                                                transition: 'height 1s ease',
                                                                minHeight: item.count > 0 ? '6px' : '2px',
                                                                '&:hover': {
                                                                    opacity: 0.85
                                                                }
                                                            }} />
                                                        </Box>
                                                    );
                                                })}
                                            </Box>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
                                                {[
                                                    { label: 'Registered' },
                                                    { label: 'Pending' },
                                                    { label: 'WIP' },
                                                    { label: 'Completed' }
                                                ].map((item, idx) => (
                                                    <Typography key={idx} variant="caption" sx={{ fontWeight: 700, color: '#64748b', width: '22%', textAlign: 'center', fontSize: '0.65rem' }}>
                                                        {item.label}
                                                    </Typography>
                                                ))}
                                            </Box>
                                        </Box>

                                        {/* Location under the bar graph in Map View */}
                                        <Box sx={{ mb: 2.5 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 800, color: '#64748b', textTransform: 'uppercase', mb: 1, display: 'block' }}>
                                                Max Complaints Location Map{stats.maxLocation && !stats.maxLocation.includes('<iframe') ? ` (${stats.maxLocation})` : ''}
                                            </Typography>
                                            <ComplaintMap 
                                                locationUrl={stats.maxLocation} 
                                                height={140} 
                                                minHeight={140} 
                                            />
                                        </Box>

                                        {/* Key Metrics details */}
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                            {/* Longest Pending Complaint */}
                                            <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', gap: 2, alignItems: 'center' }}>
                                                <Avatar sx={{ width: 32, height: 32, backgroundColor: 'rgba(249,115,22,0.1)', color: '#f97316' }}>
                                                    <AccessTimeIcon fontSize="small" />
                                                </Avatar>
                                                <Box>
                                                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                                                        Longest Pending Complaint
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a', fontSize: '0.75rem' }}>
                                                        {stats.longestPending}
                                                    </Typography>
                                                </Box>
                                            </Paper>

                                            {/* Most Reported Category */}
                                            <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', gap: 2, alignItems: 'center' }}>
                                                <Avatar sx={{ width: 32, height: 32, backgroundColor: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                                                    <CategoryIcon fontSize="small" />
                                                </Avatar>
                                                <Box>
                                                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#64748b', textTransform: 'uppercase', fontSize: '0.65rem' }}>
                                                        Most Reported Category
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a', fontSize: '0.75rem' }}>
                                                        {stats.maxCategory}
                                                    </Typography>
                                                </Box>
                                            </Paper>
                                        </Box>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Right Panel: Admin and Citizen list tab group */}
                    <Grid size={{ xs: 12, lg: 7 }}>
                        <Card sx={{
                            borderRadius: '16px',
                            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05)',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#ffffff',
                            height: '680px',
                            display: 'flex',
                            flexDirection: 'column'
                        }}>
                            <Box sx={{ borderBottom: 1, borderColor: '#e2e8f0', px: 3, pt: 2 }}>
                                <Tabs
                                    value={activeTab}
                                    onChange={(e, newTab) => setActiveTab(newTab)}
                                    textColor="primary"
                                    indicatorColor="primary"
                                    sx={{
                                        '& .MuiTab-root': {
                                            textTransform: 'none',
                                            fontWeight: 700,
                                            fontSize: '1rem',
                                            color: '#64748b'
                                        },
                                        '& .Mui-selected': {
                                            color: '#2563eb !important'
                                        }
                                    }}
                                >
                                    <Tab label={`Admins (${admins.length})`} />
                                    <Tab label={`Citizens (${citizens.length})`} />
                                </Tabs>
                            </Box>

                            <CardContent sx={{ p: 3, height: 'calc(100% - 60px)', overflowY: 'auto' }}>
                                {loadingUsers ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                                        <CircularProgress sx={{ color: '#2563eb' }} />
                                    </Box>
                                ) : (
                                    <>
                                        {activeTab === 0 && (
                                            <List sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                                                    <Button
                                                        variant="contained"
                                                        onClick={() => setCreateAdminOpen(true)}
                                                        sx={{
                                                            backgroundColor: '#14b8a6',
                                                            textTransform: 'none',
                                                            fontWeight: 700,
                                                            borderRadius: '6px',
                                                            '&:hover': { backgroundColor: '#0d9488' }
                                                        }}
                                                    >
                                                        + Create Admin
                                                    </Button>
                                                </Box>
                                                {admins.length === 0 ? (
                                                    <Typography color="#64748b" align="center" sx={{ py: 4 }}>No registered Admin accounts.</Typography>
                                                ) : (
                                                    admins.map((adm) => (
                                                        <Paper variant="outlined" key={adm.id} sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '10px' }}>
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                                <Avatar sx={{ bgcolor: '#0f172a', fontWeight: 700 }}>
                                                                    {adm.name.charAt(0)}
                                                                </Avatar>
                                                                <Box>
                                                                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a' }}>{adm.name}</Typography>
                                                                    <Typography variant="body2" color="#64748b">{adm.email || adm.mobile}</Typography>
                                                                    <Typography variant="caption" color="#94a3b8" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <LocationOnIcon fontSize="inherit" /> {adm.location}
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                            <Button
                                                                variant="outlined"
                                                                startIcon={<HistoryIcon />}
                                                                onClick={() => handleOpenActivity(adm, 'admin')}
                                                                sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#475569' }}
                                                            >
                                                                Activity
                                                            </Button>
                                                        </Paper>
                                                    ))
                                                )}
                                            </List>
                                        )}

                                        {activeTab === 1 && (
                                            <List sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                {citizens.length === 0 ? (
                                                    <Typography color="#64748b" align="center" sx={{ py: 4 }}>No registered Citizen accounts.</Typography>
                                                ) : (
                                                    citizens.map((cit) => (
                                                        <Paper variant="outlined" key={cit.id} sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '10px' }}>
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                                <Avatar sx={{ bgcolor: '#2563eb', fontWeight: 700 }}>
                                                                    {cit.name.charAt(0)}
                                                                </Avatar>
                                                                <Box>
                                                                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a' }}>{cit.name}</Typography>
                                                                    <Typography variant="body2" color="#64748b">{cit.email || cit.mobile}</Typography>
                                                                    <Typography variant="caption" color="#94a3b8" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <LocationOnIcon fontSize="inherit" /> {cit.location}
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                            <Button
                                                                variant="outlined"
                                                                startIcon={<HistoryIcon />}
                                                                onClick={() => handleOpenActivity(cit, 'citizen')}
                                                                sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#475569' }}
                                                            >
                                                                Activity
                                                            </Button>
                                                        </Paper>
                                                    ))
                                                )}
                                            </List>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>

                {/* Activity log and management Modal */}
                <Dialog
                    open={activityOpen}
                    onClose={actionLoading ? undefined : () => setActivityOpen(false)}
                    maxWidth="sm"
                    fullWidth
                    sx={{ '& .MuiDialog-paper': { borderRadius: '12px' } }}
                >
                    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                            {selectedUser?.name}'s Activity Log
                        </Typography>
                        <IconButton disabled={actionLoading} onClick={() => setActivityOpen(false)}>
                            <CloseIcon />
                        </IconButton>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 3 }}>
                        {actionError && (
                            <Alert severity="error" sx={{ mb: 2, borderRadius: '6px' }}>
                                {actionError}
                            </Alert>
                        )}

                        {loadingActivities ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                                <CircularProgress sx={{ color: '#2563eb' }} />
                            </Box>
                        ) : (
                            <>
                                <List sx={{ maxExpandedHeight: '320px', overflowY: 'auto', mb: 3 }}>
                                    {activities.length === 0 ? (
                                        <Typography color="#94a3b8" align="center" sx={{ py: 4 }}>
                                            No activities recorded.
                                        </Typography>
                                    ) : (
                                        activities.map((act, idx) => (
                                            <React.Fragment key={idx}>
                                                <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                                                    <ListItemAvatar sx={{ minWidth: '40px' }}>
                                                        <Avatar sx={{ width: 32, height: 32, bgcolor: '#e2e8f0', color: '#64748b' }}>
                                                            <HistoryIcon fontSize="small" />
                                                        </Avatar>
                                                    </ListItemAvatar>
                                                    <ListItemText
                                                        primary={
                                                            <Typography variant="body2" sx={{ fontWeight: 700, color: '#334155' }}>
                                                                {act.title}
                                                            </Typography>
                                                        }
                                                        secondary={
                                                            <>
                                                                <Typography variant="caption" color="#64748b" component="span" sx={{ display: 'block', mt: 0.5 }}>
                                                                    {act.description}
                                                                </Typography>
                                                                {act.dateTime && (
                                                                    <Typography variant="caption" color="#cbd5e1" sx={{ fontSize: '0.65rem' }}>
                                                                        {act.dateTime}
                                                                    </Typography>
                                                                )}
                                                            </>
                                                        }
                                                    />
                                                </ListItem>
                                                {idx < activities.length - 1 && <Divider component="li" />}
                                            </React.Fragment>
                                        ))
                                    )}
                                </List>

                                {/* Action Buttons */}
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, pt: 1 }}>
                                    {selectedUserRole === 'admin' ? (
                                        <Button
                                            variant="contained"
                                            color="error"
                                            startIcon={actionLoading ? <CircularProgress size={18} color="inherit" /> : <DeleteIcon />}
                                            onClick={() => selectedUser && handleDeleteAdmin(selectedUser.id)}
                                            disabled={actionLoading}
                                            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}
                                        >
                                            Delete Admin
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="contained"
                                            color="error"
                                            startIcon={actionLoading ? <CircularProgress size={18} color="inherit" /> : <BlockIcon />}
                                            onClick={() => selectedUser && handleBlockCitizen(selectedUser.id)}
                                            disabled={actionLoading}
                                            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}
                                        >
                                            Block Citizen
                                        </Button>
                                    )}
                                </Box>
                            </>
                        )}
                    </DialogContent>
                </Dialog>

                {/* Create Admin Dialog */}
                <Dialog
                    open={createAdminOpen}
                    onClose={createAdminLoading ? undefined : () => { setCreateAdminOpen(false); setCreateAdminError(null); }}
                    maxWidth="sm"
                    fullWidth
                    sx={{ '& .MuiDialog-paper': { borderRadius: '12px' } }}
                >
                    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>Create New Admin</Typography>
                        <IconButton disabled={createAdminLoading} onClick={() => { setCreateAdminOpen(false); setCreateAdminError(null); }}>
                            <CloseIcon />
                        </IconButton>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 3 }}>
                        {createAdminError && (
                            <Alert severity="error" sx={{ mb: 2, borderRadius: '6px' }}>{createAdminError}</Alert>
                        )}
                        <form onSubmit={handleCreateAdmin}>
                            <TextField label="Full Name" required fullWidth value={createAdminForm.name}
                                onChange={e => setCreateAdminForm(f => ({...f, name: e.target.value}))}
                                disabled={createAdminLoading} sx={{ mb: 2 }} />
                            <TextField label="Username" required fullWidth value={createAdminForm.username}
                                onChange={e => setCreateAdminForm(f => ({...f, username: e.target.value}))}
                                disabled={createAdminLoading} sx={{ mb: 2 }} />
                            <TextField label="Email" fullWidth value={createAdminForm.email}
                                onChange={e => setCreateAdminForm(f => ({...f, email: e.target.value}))}
                                disabled={createAdminLoading} sx={{ mb: 2 }} />
                            <TextField label="Phone" fullWidth value={createAdminForm.phone}
                                onChange={e => setCreateAdminForm(f => ({...f, phone: e.target.value}))}
                                disabled={createAdminLoading} sx={{ mb: 2 }} />
                            <TextField label="Password" type={showCreateAdminPassword ? 'text' : 'password'} required fullWidth value={createAdminForm.password}
                                onChange={e => setCreateAdminForm(f => ({...f, password: e.target.value}))}
                                disabled={createAdminLoading} sx={{ mb: 3 }}
                                helperText="Minimum 8 characters"
                                slotProps={{
                                    input: {
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton onClick={() => setShowCreateAdminPassword(v => !v)} edge="end" size="small" tabIndex={-1}>
                                                    {showCreateAdminPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    },
                                }} />
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                                <Button variant="outlined" onClick={() => { setCreateAdminOpen(false); setCreateAdminError(null); }}
                                    disabled={createAdminLoading}
                                    sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#475569' }}>
                                    Cancel
                                </Button>
                                <Button type="submit" variant="contained" disabled={createAdminLoading}
                                    sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#14b8a6', '&:hover': { backgroundColor: '#0d9488' } }}>
                                    {createAdminLoading ? <CircularProgress size={20} color="inherit" /> : 'Create Admin'}
                                </Button>
                            </Box>
                        </form>
                    </DialogContent>
                </Dialog>

            </Container>
        </Box>
    );
}
