import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Button,
    TextField,
    Alert,
    CircularProgress,
    Divider,
    Avatar,
    IconButton,
    Tooltip,
    Dialog,
    DialogContent,
    Slide,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import SaveIcon from '@mui/icons-material/Save';
import PersonIcon from '@mui/icons-material/Person';
import LockIcon from '@mui/icons-material/Lock';
import HomeIcon from '@mui/icons-material/Home';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InputAdornment from '@mui/material/InputAdornment';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import type { RootState } from '../../reducers';
import { getProfile, postUpdateProfile } from '../../apis/functions';
import { loginSuccess } from '../../actions/auth.slice';

// Slide-up transition for the dialog
const SlideUp = React.forwardRef(function Transition(
    props: TransitionProps & { children: React.ReactElement },
    ref: React.Ref<unknown>,
) {
    return <Slide direction="up" ref={ref} {...props} />;
});

interface ProfileProps {
    open: boolean;
    onClose: () => void;
}

// Represents a single profile field row: label + read-only text + edit icon
interface FieldRowProps {
    label: string;
    value: string;
    editingField: string | null;
    fieldKey: string;
    editValue: string;
    onEdit: (key: string) => void;
    onCancelEdit: () => void;
    onChangeEdit: (val: string) => void;
    multiline?: boolean;
    disabled?: boolean;
}

function FieldRow({
    label,
    value,
    editingField,
    fieldKey,
    editValue,
    onEdit,
    onCancelEdit,
    onChangeEdit,
    multiline = false,
    disabled = false,
}: FieldRowProps) {
    const isEditing = editingField === fieldKey;

    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            py: 1.5,
            px: 2,
            borderRadius: '8px',
            transition: 'background-color 0.2s ease',
            '&:hover': {
                backgroundColor: isEditing ? 'transparent' : 'rgba(59,130,246,0.04)',
            },
        }}>
            {/* Label */}
            <Typography sx={{
                minWidth: { xs: '100px', sm: '140px' },
                fontWeight: 600,
                color: '#64748b',
                fontSize: '0.875rem',
                pt: isEditing ? '10px' : '2px',
                flexShrink: 0,
            }}>
                {label}
            </Typography>

            {/* Value or Edit Input */}
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                {isEditing ? (
                    <>
                        <TextField
                            fullWidth
                            size="small"
                            multiline={multiline}
                            rows={multiline ? 3 : 1}
                            value={editValue}
                            onChange={(e) => onChangeEdit(e.target.value)}
                            disabled={disabled}
                            autoFocus
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '8px',
                                    backgroundColor: '#f8fafc',
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                        borderColor: '#3b82f6',
                                        borderWidth: '2px',
                                    },
                                },
                            }}
                        />
                        <Tooltip title="Cancel">
                            <IconButton
                                size="small"
                                onClick={onCancelEdit}
                                sx={{
                                    color: '#94a3b8',
                                    mt: '4px',
                                    '&:hover': {
                                        color: '#ef4444',
                                        backgroundColor: 'rgba(239,68,68,0.08)',
                                    }
                                }}
                            >
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </>
                ) : (
                    <>
                        <Typography sx={{
                            color: value ? '#0f172a' : '#cbd5e1',
                            fontSize: '0.95rem',
                            fontWeight: 500,
                            pt: '2px',
                            flex: 1,
                            wordBreak: 'break-word',
                        }}>
                            {value || '—'}
                        </Typography>
                        <Tooltip title="Edit">
                            <IconButton
                                size="small"
                                onClick={() => onEdit(fieldKey)}
                                disabled={disabled}
                                sx={{
                                    color: '#94a3b8',
                                    '&:hover': {
                                        color: '#3b82f6',
                                        backgroundColor: 'rgba(59,130,246,0.08)',
                                    },
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </>
                )}
            </Box>
        </Box>
    );
}

export default function Profile({ open, onClose }: ProfileProps) {
    const dispatch = useAppDispatch();
    const { user } = useSelector((state: RootState) => state.auth);
    const loginUserObj = user as any;
    const userId = loginUserObj?.user?.id || loginUserObj?.id || '';
    const role = loginUserObj?.user?.role || 'citizen';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Profile data (read-only display values)
    const [profileData, setProfileData] = useState({
        firstname: '',
        lastname: '',
        email: '',
        mobile: '',
        address: '',
        city: '',
        state: '',
        aadhar: '',
    });

    // Editing state
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    // Track all pending edits
    const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

    // Password change fields
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        if (!open) return;

        const loadProfile = async () => {
            try {
                setLoading(true);
                setError(null);

                // Load from the login user data (our backend shape: { user: { id, name, phone, email, role } })
                const userData = loginUserObj?.user || loginUserObj;
                if (userData && (userData.name || userData.phone)) {
                    // Split name into first/last for the form display
                    const nameParts = (userData.name || '').split(' ');
                    setProfileData({
                        firstname: nameParts[0] || '',
                        lastname:  nameParts.slice(1).join(' ') || '',
                        email:     userData.email  || '',
                        mobile:    userData.phone  || userData.mobile || '',
                        address:   userData.address || '',
                        city:      userData.city   || '',
                        state:     userData.state  || '',
                        aadhar:    userData.aadhar || '',
                    });
                    setLoading(false);
                    return;
                }

                // Fallback: fetch from API (uses JWT Bearer auto-attached)
                const data = await getProfile({ role, userId });
                if (data) {
                    const p = data.user || data.profile || data;
                    const nameParts2 = (p.name || '').split(' ');
                    setProfileData({
                        firstname: p.firstname || nameParts2[0] || '',
                        lastname:  p.lastname  || nameParts2.slice(1).join(' ') || '',
                        email:     p.email     || '',
                        mobile:    p.phone     || p.mobile || '',
                        address:   p.address   || '',
                        city:      p.city      || '',
                        state:     p.state     || '',
                        aadhar:    p.aadhar    || '',
                    });
                } else {
                    setError('Failed to retrieve profile details.');
                }
            } catch (err: any) {
                console.error(err);
                // If API fails but we have user data from login, use that
                const userData = loginUserObj?.user;
                if (userData && (userData.firstname || userData.email)) {
                    setProfileData({
                        firstname: userData.firstname || '',
                        lastname: userData.lastname || '',
                        email: userData.email || '',
                        mobile: userData.mobile || '',
                        address: userData.address || '',
                        city: userData.city || '',
                        state: userData.state || '',
                        aadhar: userData.aadhar || '',
                    });
                } else {
                    setError(err.response?.data?.message || err.message || 'Error loading profile details.');
                }
            } finally {
                setLoading(false);
            }
        };

        if (userId) {
            loadProfile();
        } else {
            setLoading(false);
        }
    }, [open, role, userId]);

    const handleStartEdit = (fieldKey: string) => {
        const currentVal = pendingEdits[fieldKey] !== undefined
            ? pendingEdits[fieldKey]
            : profileData[fieldKey as keyof typeof profileData];
        setEditingField(fieldKey);
        setEditValue(currentVal);
    };

    const handleCancelEdit = () => {
        setEditingField(null);
        setEditValue('');
    };

    const handleConfirmFieldEdit = () => {
        if (editingField) {
            setPendingEdits(prev => ({ ...prev, [editingField]: editValue }));
            setProfileData(prev => ({ ...prev, [editingField]: editValue }));
            setEditingField(null);
            setEditValue('');
        }
    };

    const handleChangeEdit = (val: string) => {
        setEditValue(val);
        if (editingField) {
            setPendingEdits(prev => ({ ...prev, [editingField]: val }));
            setProfileData(prev => ({ ...prev, [editingField]: val }));
        }
    };

    const hasPendingChanges = Object.keys(pendingEdits).length > 0 || password.length > 0;

    const handleSaveAll = async () => {
        setError(null);
        setSuccessMessage(null);

        if (editingField) {
            handleConfirmFieldEdit();
        }

        if (!profileData.firstname.trim() || !profileData.lastname.trim() || !profileData.email.trim() || !profileData.mobile.trim()) {
            setError('First Name, Last Name, Email, and Mobile are required.');
            return;
        }

        if (password) {
            if (password.length < 6) {
                setError('Password must be at least 6 characters.');
                return;
            }
            if (password !== confirmPassword) {
                setError('Passwords do not match.');
                return;
            }
        }

        try {
            setSaving(true);
            const updatePayload = {
                firstname: profileData.firstname.trim(),
                lastname: profileData.lastname.trim(),
                email: profileData.email.trim(),
                mobile: profileData.mobile.trim(),
                address: profileData.address.trim(),
                city: profileData.city.trim(),
                state: profileData.state.trim(),
                aadhar: profileData.aadhar.trim(),
                password: password || undefined,
            };

            const data = await postUpdateProfile({
                name:  `${profileData.firstname.trim()} ${profileData.lastname.trim()}`.trim(),
                email: profileData.email.trim(),
                phone: profileData.mobile.trim(),
            });
            if (data) {
                setSuccessMessage('Profile updated successfully!');
                setPendingEdits({});
                setPassword('');
                setConfirmPassword('');

                // Update the Redux store and sessionStorage
                const updatedUser = {
                    ...loginUserObj,
                    user: {
                        ...loginUserObj?.user,
                        ...updatePayload,
                        password: undefined,
                    }
                };
                sessionStorage.setItem('user', JSON.stringify(updatedUser));
                dispatch(loginSuccess(updatedUser));
            } else {
                setError(data.message || 'Failed to update profile.');
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.message || err.message || 'Error saving profile.');
        } finally {
            setSaving(false);
        }
    };

    // Field definitions
    const personalFields = [
        { key: 'firstname', label: 'First Name' },
        { key: 'lastname', label: 'Last Name' },
        { key: 'email', label: 'Email' },
        { key: 'mobile', label: 'Mobile' },
        { key: 'aadhar', label: role === 'admin' ? 'Admin ID' : 'Aadhar Number' },
    ];

    const addressFields = [
        { key: 'address', label: 'Address', multiline: true },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
    ];

    return (
        <Dialog
            open={open}
            onClose={onClose}
            slots={{
                transition: SlideUp,
            }}
            maxWidth="md"
            fullWidth
            slotProps={{
                paper: {
                    sx: {
                        borderRadius: '20px',
                        background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        maxHeight: '90vh',
                        overflow: 'hidden',
                    },
                },
                backdrop: {
                    sx: {
                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(8px)',
                    },
                },
            }}
        >
            {/* Sticky Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: { xs: 3, sm: 4 },
                py: 2.5,
                borderBottom: '1px solid #e2e8f0',
                background: 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(12px)',
                position: 'sticky',
                top: 0,
                zIndex: 10,
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{
                        width: 48,
                        height: 48,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                        fontWeight: 800,
                        fontSize: '1.1rem',
                        boxShadow: '0 4px 12px -2px rgba(59,130,246,0.4)',
                    }}>
                        {(profileData.firstname[0] || '').toUpperCase()}{(profileData.lastname[0] || 'U').toUpperCase()}
                    </Avatar>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.025em', lineHeight: 1.2 }}>
                            My Profile
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#64748b', fontSize: '0.8rem' }}>
                            View and edit your account details
                        </Typography>
                    </Box>
                </Box>
                <IconButton
                    onClick={onClose}
                    sx={{
                        color: '#64748b',
                        backgroundColor: '#f1f5f9',
                        '&:hover': {
                            backgroundColor: '#e2e8f0',
                            color: '#0f172a',
                        },
                        transition: 'all 0.2s ease',
                    }}
                >
                    <CloseIcon />
                </IconButton>
            </Box>

            {/* Scrollable Content */}
            <DialogContent sx={{ px: { xs: 3, sm: 4 }, py: 3, overflowY: 'auto' }}>
                {error && (
                    <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {successMessage && (
                    <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }} onClose={() => setSuccessMessage(null)}>
                        {successMessage}
                    </Alert>
                )}

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                        <CircularProgress sx={{ color: '#2563eb' }} />
                    </Box>
                ) : (
                    <Box>
                        {/* Personal Information Section */}
                        <Box sx={{ mb: 3.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1 }}>
                                <PersonIcon sx={{ color: '#3b82f6', fontSize: '1.2rem' }} />
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
                                    Personal Information
                                </Typography>
                            </Box>
                            <Box sx={{
                                backgroundColor: '#f8fafc',
                                borderRadius: '12px',
                                border: '1px solid #e2e8f0',
                                py: 0.5,
                            }}>
                                {personalFields.map((field, idx) => (
                                    <React.Fragment key={field.key}>
                                        <FieldRow
                                            label={field.label}
                                            value={profileData[field.key as keyof typeof profileData]}
                                            editingField={editingField}
                                            fieldKey={field.key}
                                            editValue={editValue}
                                            onEdit={handleStartEdit}
                                            onCancelEdit={handleCancelEdit}
                                            onChangeEdit={handleChangeEdit}
                                            disabled={saving}
                                        />
                                        {idx < personalFields.length - 1 && (
                                            <Divider sx={{ mx: 2, borderColor: '#e2e8f0' }} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </Box>
                        </Box>

                        {/* Address & Location Section */}
                        <Box sx={{ mb: 3.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1 }}>
                                <HomeIcon sx={{ color: '#3b82f6', fontSize: '1.2rem' }} />
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
                                    Address & Location
                                </Typography>
                            </Box>
                            <Box sx={{
                                backgroundColor: '#f8fafc',
                                borderRadius: '12px',
                                border: '1px solid #e2e8f0',
                                py: 0.5,
                            }}>
                                {addressFields.map((field, idx) => (
                                    <React.Fragment key={field.key}>
                                        <FieldRow
                                            label={field.label}
                                            value={profileData[field.key as keyof typeof profileData]}
                                            editingField={editingField}
                                            fieldKey={field.key}
                                            editValue={editValue}
                                            onEdit={handleStartEdit}
                                            onCancelEdit={handleCancelEdit}
                                            onChangeEdit={handleChangeEdit}
                                            multiline={field.multiline}
                                            disabled={saving}
                                        />
                                        {idx < addressFields.length - 1 && (
                                            <Divider sx={{ mx: 2, borderColor: '#e2e8f0' }} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </Box>
                        </Box>

                        {/* Security Settings Section */}
                        <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1 }}>
                                <LockIcon sx={{ color: '#3b82f6', fontSize: '1.2rem' }} />
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
                                    Security Settings
                                </Typography>
                            </Box>
                            <Typography variant="body2" color="#64748b" sx={{ mb: 1.5, px: 1, fontSize: '0.8rem' }}>
                                Leave blank if you do not wish to change your password.
                            </Typography>
                            <Box sx={{
                                backgroundColor: '#f8fafc',
                                borderRadius: '12px',
                                border: '1px solid #e2e8f0',
                                py: 1.5,
                                px: 2,
                            }}>
                                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                                    <TextField
                                        label="New Password"
                                        type={showPassword ? 'text' : 'password'}
                                        fullWidth
                                        size="small"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={saving}
                                        slotProps={{
                                            input: {
                                                endAdornment: (
                                                    <InputAdornment position="end">
                                                        <IconButton onClick={() => setShowPassword(v => !v)} edge="end" size="small" tabIndex={-1}>
                                                            {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                                        </IconButton>
                                                    </InputAdornment>
                                                ),
                                            },
                                        }}
                                        sx={{
                                            '& .MuiOutlinedInput-root': {
                                                borderRadius: '8px',
                                                backgroundColor: '#fff',
                                            },
                                        }}
                                    />
                                    <TextField
                                        label="Confirm Password"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        fullWidth
                                        size="small"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        disabled={saving}
                                        slotProps={{
                                            input: {
                                                endAdornment: (
                                                    <InputAdornment position="end">
                                                        <IconButton onClick={() => setShowConfirmPassword(v => !v)} edge="end" size="small" tabIndex={-1}>
                                                            {showConfirmPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                                        </IconButton>
                                                    </InputAdornment>
                                                ),
                                            },
                                        }}
                                        sx={{
                                            '& .MuiOutlinedInput-root': {
                                                borderRadius: '8px',
                                                backgroundColor: '#fff',
                                            },
                                        }}
                                    />
                                </Box>
                            </Box>
                        </Box>

                        {/* Save Button */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, pt: 1 }}>
                            <Button
                                onClick={handleSaveAll}
                                disabled={saving || !hasPendingChanges}
                                variant="contained"
                                startIcon={saving ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : <SaveIcon />}
                                sx={{
                                    background: hasPendingChanges
                                        ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                                        : '#94a3b8',
                                    color: '#ffffff',
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    borderRadius: '10px',
                                    px: 4,
                                    py: 1.5,
                                    fontSize: '0.95rem',
                                    boxShadow: hasPendingChanges
                                        ? '0 4px 14px -3px rgba(59,130,246,0.5)'
                                        : 'none',
                                    '&:hover': {
                                        background: hasPendingChanges
                                            ? 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)'
                                            : '#94a3b8',
                                    },
                                    '&.Mui-disabled': {
                                        background: '#e2e8f0',
                                        color: '#94a3b8',
                                    }
                                }}
                            >
                                {saving ? 'Saving...' : 'Update All Changes'}
                            </Button>
                            {hasPendingChanges && (
                                <Typography variant="body2" sx={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.85rem' }}>
                                    ● You have unsaved changes
                                </Typography>
                            )}
                        </Box>
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
}
