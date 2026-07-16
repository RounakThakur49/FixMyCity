import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import type { RootState } from '../../reducers';
import { updateStatusRequest, updateStatusReset, fetchAdminHomeRequest } from '../../actions/admin.slice';
import {
    Box,
    Typography,
    Button,
    TextField,
    MenuItem,
    Alert,
    CircularProgress,
    IconButton,
    Dialog,
    DialogContent
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloseIcon from '@mui/icons-material/Close';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

interface UpdateStatusProps {
    complaint: any;
    onClose: () => void;
    isInline?: boolean;
    onSuccess?: () => void;
}

const WORK_STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'work-on-progress', label: 'Work on Progress' },
    { value: 'completed', label: 'Completed' }
];

export default function UpdateStatus({ complaint, onClose, isInline = false, onSuccess }: UpdateStatusProps) {
    const dispatch = useAppDispatch();
    const { user } = useSelector((state: RootState) => state.auth);
    const { updateStatusLoading, updateStatusError, updateStatusSuccess } = useSelector((state: RootState) => state.admin);

    const loginUserObj = user as any;
    const userId = loginUserObj?.user?.id || loginUserObj?.id || '';
    const role   = loginUserObj?.user?.role || loginUserObj?.role || 'admin';

    const [workstatus, setWorkstatus] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [dateTime, setDateTime] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [formValidation, setFormValidation] = useState<string | null>(null);

    // Default dateTime to current local time in ISO format (YYYY-MM-DDThh:mm)
    useEffect(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        setDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);

        // Prefill default status based on current complaint status if available
        if (complaint) {
            const currentStatus = (complaint.status || '').toLowerCase();
            if (currentStatus.includes('progress') || currentStatus.includes('work-on-progress')) {
                setWorkstatus('work-on-progress');
            } else if (currentStatus.includes('complete')) {
                setWorkstatus('completed');
            } else {
                setWorkstatus('pending');
            }
        } else {
            setWorkstatus('pending');
        }
    }, [complaint]);

    // Clean up photo preview URL
    useEffect(() => {
        return () => {
            if (photoPreview) {
                URL.revokeObjectURL(photoPreview);
            }
        };
    }, [photoPreview]);

    // Handle successful update: refresh admin dashboard, reset update state, and close modal
    useEffect(() => {
        if (updateStatusSuccess) {
            dispatch(fetchAdminHomeRequest({ userId, role }));
            dispatch(updateStatusReset());
            if (onSuccess) {
                onSuccess();
            } else {
                onClose();
            }
        }
    }, [updateStatusSuccess, dispatch, onClose, onSuccess, userId, role]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setPhoto(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormValidation(null);

        if (!workstatus || !title.trim() || !description.trim()) {
            setFormValidation('Please fill out all required fields (Status, Title, and Description).');
            return;
        }

        const formData = new FormData();
        formData.append('workstatus', workstatus);
        formData.append('title', title.trim());
        formData.append('description', description.trim());
        formData.append('dateTime', dateTime);
        if (photo) {
            formData.append('photo', photo);
        }

        dispatch(updateStatusRequest({
            complaintId: complaint.id || complaint._id,
            formData,
            userId,
            role
        }));
    };

    const renderFormContent = () => (
        <Box sx={{
            p: isInline ? 0 : { xs: 2.5, sm: 4 },
            borderRadius: isInline ? 0 : '5px',
            backgroundColor: isInline ? 'transparent' : 'rgba(255, 255, 255, 0.98)',
            backdropFilter: isInline ? 'none' : 'blur(10px)',
        }}>
            {/* Top navigation header row */}
            {!isInline && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.025em' }}>
                            Update Work Status
                        </Typography>
                        <Typography variant="body2" color="#64748b" sx={{ mt: 0.5 }}>
                            Complaint: <span style={{ fontWeight: 600, color: '#0f172a' }}>{complaint?.title}</span>
                        </Typography>
                    </Box>
                    <IconButton
                        onClick={onClose}
                        disabled={updateStatusLoading}
                        sx={{ color: '#475569', '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' } }}
                    >
                        <CloseIcon />
                    </IconButton>
                </Box>
            )}

            {formValidation && (
                <Alert severity="warning" sx={{ mb: 3, borderRadius: '6px' }}>
                    {formValidation}
                </Alert>
            )}

            {updateStatusError && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: '6px' }}>
                    {updateStatusError}
                </Alert>
            )}

            <form onSubmit={handleSubmit} noValidate>
                {/* Status Dropdown */}
                <TextField
                    select
                    label="Work Status"
                    required
                    fullWidth
                    value={workstatus}
                    onChange={(e) => setWorkstatus(e.target.value)}
                    disabled={updateStatusLoading}
                    sx={{ mb: 2.5 }}
                >
                    {WORK_STATUS_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                            {option.label}
                        </MenuItem>
                    ))}
                </TextField>

                {/* Title input */}
                <TextField
                    label="Update Title"
                    required
                    fullWidth
                    variant="outlined"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={updateStatusLoading}
                    placeholder="e.g. Work started / Rubbish cleared"
                    sx={{ mb: 2.5 }}
                />

                {/* Description input */}
                <TextField
                    label="Description / Progress Update"
                    required
                    fullWidth
                    multiline
                    rows={4}
                    variant="outlined"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={updateStatusLoading}
                    placeholder="Provide details about the action taken, tools used, or completion details..."
                    sx={{ mb: 2.5 }}
                />

                {/* Date and Time Picker */}
                <TextField
                    label="Update Date & Time"
                    type="datetime-local"
                    fullWidth
                    required
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    disabled={updateStatusLoading}
                    sx={{ mb: 3 }}
                />

                {/* Image file upload */}
                <Box sx={{ mb: 4 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#475569', mb: 1 }}>
                        Upload Progress/Completion Photo (Optional)
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Button
                            variant="outlined"
                            component="label"
                            disabled={updateStatusLoading}
                            startIcon={<CloudUploadIcon />}
                            sx={{
                                borderColor: '#cbd5e1',
                                color: '#475569',
                                textTransform: 'none',
                                '&:hover': {
                                    borderColor: '#94a3b8',
                                    backgroundColor: '#f8fafc'
                                }
                            }}
                        >
                            Choose Photo
                            <input
                                type="file"
                                accept="image/jpeg,image/jpg,image/png"
                                hidden
                                onChange={handleFileChange}
                            />
                        </Button>

                        <Button
                            variant="outlined"
                            component="label"
                            disabled={updateStatusLoading}
                            startIcon={<PhotoCameraIcon />}
                            sx={{
                                borderColor: '#cbd5e1',
                                color: '#475569',
                                textTransform: 'none',
                                '&:hover': {
                                    borderColor: '#94a3b8',
                                    backgroundColor: '#f8fafc'
                                }
                            }}
                        >
                            Take Photo
                            <input
                                type="file"
                                accept="image/jpeg,image/jpg,image/png"
                                capture="environment"
                                hidden
                                onChange={handleFileChange}
                            />
                        </Button>

                        {photo && (
                            <Typography variant="body2" color="#64748b" noWrap sx={{ maxWidth: '180px' }}>
                                {photo.name}
                            </Typography>
                        )}
                    </Box>

                    {photoPreview && (
                        <Box sx={{
                            mt: 2,
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '1px solid #e2e8f0',
                            width: '100%',
                            height: '200px',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                        }}>
                            <img
                                src={photoPreview}
                                alt="Preview"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <IconButton
                                size="small"
                                onClick={() => {
                                    setPhoto(null);
                                    setPhotoPreview(null);
                                }}
                                sx={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    backgroundColor: 'rgba(0,0,0,0.5)',
                                    color: '#fff',
                                    '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' }
                                }}
                            >
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    )}
                </Box>

                {/* Submit and Cancel Buttons */}
                <Box sx={{ display: 'flex', gap: 2 }}>
                    {!isInline && (
                        <Button
                            variant="outlined"
                            fullWidth
                            disabled={updateStatusLoading}
                            onClick={onClose}
                            sx={{
                                borderColor: '#cbd5e1',
                                color: '#475569',
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: '6px',
                                '&:hover': {
                                    borderColor: '#94a3b8',
                                    backgroundColor: '#f1f5f9'
                                }
                            }}
                        >
                            Cancel
                        </Button>
                    )}

                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        disabled={updateStatusLoading}
                        sx={{
                            backgroundColor: '#0f172a',
                            color: '#ffffff',
                            textTransform: 'none',
                            fontWeight: 700,
                            borderRadius: '6px',
                            '&:hover': {
                                backgroundColor: '#1e293b'
                            }
                        }}
                    >
                        {updateStatusLoading ? <CircularProgress size={24} sx={{ color: '#fff' }} /> : 'Update Status'}
                    </Button>
                </Box>
            </form>
        </Box>
    );

    if (isInline) {
        return renderFormContent();
    }

    return (
        <Dialog
            open={!!complaint}
            onClose={updateStatusLoading ? undefined : onClose}
            maxWidth="sm"
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
                {renderFormContent()}
            </DialogContent>
        </Dialog>
    );
}
