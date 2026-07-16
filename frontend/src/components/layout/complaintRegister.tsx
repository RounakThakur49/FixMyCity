import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useAppDispatch } from '../../store/store';
import type { RootState } from '../../reducers';
import { registerComplaintRequest, registerComplaintReset, fetchUserHomeRequest } from '../../actions/citizen.slice';
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
import MyLocationIcon from '@mui/icons-material/MyLocation';

interface ComplaintRegisterProps {
    onCancel: () => void;
}

// Must match the backend Complaint model's type enum AND the ML model's 4 classes
const ISSUE_TYPES = [
    { value: 'Broken street light problem', label: 'Street Light Problem' },
    { value: 'Potholes',                   label: 'Potholes / Road Damage' },
    { value: 'Drainage problem',            label: 'Drainage Problem' },
    { value: 'Others',                      label: 'Others' },
];

function compressImage(file: File, maxDim = 800, quality = 0.7): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Failed to load image')); };
        img.src = objUrl;
    });
}

export default function ComplaintRegister({ onCancel }: ComplaintRegisterProps) {
    const dispatch = useAppDispatch();
    const { user } = useSelector((state: RootState) => state.auth);
    const { loading, error, registerSuccess } = useSelector((state: RootState) => state.citizen);

    const loginUserObj = user as any;
    // Backend returns { token, user: { id, name, phone, role } }
    const userId = loginUserObj?.user?.id || loginUserObj?.id || '';
    const role   = loginUserObj?.user?.role || loginUserObj?.role || 'citizen';
    const citizenPhone = loginUserObj?.user?.phone || loginUserObj?.phone || '';

    const [title, setTitle] = useState('');
    const [issueType, setIssueType] = useState('');
    const [locationUrl, setLocationUrl] = useState('');
    const [description, setDescription] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [formValidation, setFormValidation] = useState<string | null>(null);
    const [isLocating, setIsLocating] = useState(false);

    // Clean up photo preview URL
    useEffect(() => {
        return () => {
            if (photoPreview) {
                URL.revokeObjectURL(photoPreview);
            }
        };
    }, [photoPreview]);

    // Handle successful registration: refetch user home, reset state, and navigate back
    useEffect(() => {
        if (registerSuccess) {
            dispatch(fetchUserHomeRequest({ userId, role }));
            dispatch(registerComplaintReset());
            onCancel();
        }
    }, [registerSuccess, dispatch, onCancel, userId, role]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setPhoto(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
    };

    const handleGetGPSLocation = () => {
        if (!navigator.geolocation) {
            setFormValidation('Geolocation is not supported by your browser.');
            return;
        }

        setIsLocating(true);
        setFormValidation(null);

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
                    );
                    if (!response.ok) {
                        throw new Error('Reverse geocoding failed');
                    }
                    const data = await response.json();
                    if (data && data.display_name) {
                        setLocationUrl(data.display_name);
                    } else {
                        setLocationUrl(`${latitude}, ${longitude}`);
                    }
                } catch (err) {
                    console.error('Nominatim reverse geocoding failed, falling back to coordinates:', err);
                    setLocationUrl(`${latitude}, ${longitude}`);
                } finally {
                    setIsLocating(false);
                }
            },
            (error) => {
                console.error('Error getting GPS location:', error);
                let errMsg = 'Failed to retrieve your location.';
                if (error.code === error.PERMISSION_DENIED) {
                    errMsg = 'Location access was denied. Please allow location permissions in your browser.';
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    errMsg = 'Location information is unavailable.';
                } else if (error.code === error.TIMEOUT) {
                    errMsg = 'Request to get user location timed out.';
                }
                setFormValidation(errMsg);
                setIsLocating(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormValidation(null);

        if (!title.trim() || !issueType || !description.trim()) {
            setFormValidation('Please fill out all required fields (Title, Category, and Description).');
            return;
        }

        // Build JSON body matching POST /api/complaints backend contract
        // { title, type, location, description, image? }
        const body: Record<string, any> = {
            title:       title.trim(),
            type:        issueType,           // backend field is 'type', matches Complaint model enum
            location:    locationUrl.trim(),  // backend field is 'location'
            description: description.trim(),
        };

        if (photo) {
            compressImage(photo, 800, 0.7)
                .then(base64 => {
                    body.image = base64;
                    dispatch(registerComplaintRequest({ formData: buildFormData(body), userId, role }));
                })
                .catch(() => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        body.image = reader.result as string;
                        dispatch(registerComplaintRequest({ formData: buildFormData(body), userId, role }));
                    };
                    reader.readAsDataURL(photo);
                });
        } else {
            dispatch(registerComplaintRequest({ formData: buildFormData(body), userId, role }));
        }
    };

    // Convert a plain object to FormData so the existing saga interface stays intact
    function buildFormData(obj: Record<string, any>): FormData {
        const fd = new FormData();
        Object.entries(obj).forEach(([k, v]) => fd.append(k, v));
        return fd;
    }

    return (
        <Dialog
            open={true}
            onClose={loading ? undefined : onCancel}
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
                <Box sx={{
                    p: { xs: 2.5, sm: 4 },
                    borderRadius: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    backdropFilter: 'blur(10px)',
                }}>
                    {/* Top navigation header row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                        <Typography variant="h5" sx={{ fontWeight: 700, color: '#1e293b' }}>
                            Register New Complaint
                        </Typography>
                        <IconButton 
                            onClick={onCancel}
                            disabled={loading}
                            sx={{ color: '#475569', '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' } }}
                        >
                            <CloseIcon />
                        </IconButton>
                    </Box>

                    {formValidation && (
                        <Alert severity="warning" sx={{ mb: 3, borderRadius: '5px' }}>
                            {formValidation}
                        </Alert>
                    )}

                    {error && (
                        <Alert
                            severity="error"
                            sx={{
                                mb: 3,
                                borderRadius: '5px',
                                '& .MuiAlert-message': { width: '100%' },
                            }}
                        >
                            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                Image Validation Failed
                            </Typography>
                            <Typography variant="body2">
                                {error}
                            </Typography>
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} noValidate>
                        {/* Title input */}
                        <TextField
                            label="Complaint Title"
                            required
                            fullWidth
                            variant="outlined"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={loading}
                            placeholder="e.g. Broken streetlight on main road"
                            sx={{ mb: 2.5 }}
                        />

                        {/* Category Selector */}
                        <TextField
                            select
                            label="Category / Issue Type"
                            required
                            fullWidth
                            value={issueType}
                            onChange={(e) => setIssueType(e.target.value)}
                            disabled={loading}
                            sx={{ mb: 2.5 }}
                        >
                            {ISSUE_TYPES.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </TextField>

                        {/* Location input */}
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 2.5 }}>
                            <TextField
                                label="Location URL / Address"
                                fullWidth
                                variant="outlined"
                                value={locationUrl}
                                onChange={(e) => setLocationUrl(e.target.value)}
                                disabled={loading || isLocating}
                                placeholder="Map link or specific address details"
                                sx={{ flexGrow: 1 }}
                            />
                            <IconButton
                                color="primary"
                                onClick={handleGetGPSLocation}
                                disabled={loading || isLocating}
                                title="Locate via GPS"
                                sx={{
                                    height: 56,
                                    width: 56,
                                    borderRadius: '5px',
                                    border: '1px solid #cbd5e1',
                                    backgroundColor: '#f8fafc',
                                    color: '#475569',
                                    flexShrink: 0,
                                    '&:hover': {
                                        backgroundColor: '#f1f5f9',
                                        borderColor: '#94a3b8',
                                        color: '#14b8a6'
                                    },
                                    '&.Mui-disabled': {
                                        backgroundColor: '#f1f5f9',
                                        color: '#cbd5e1'
                                    }
                                }}
                            >
                                {isLocating ? (
                                    <CircularProgress size={24} sx={{ color: '#14b8a6' }} />
                                ) : (
                                    <MyLocationIcon />
                                )}
                            </IconButton>
                        </Box>

                        {/* Description input */}
                        <TextField
                            label="Description"
                            required
                            fullWidth
                            multiline
                            rows={4}
                            variant="outlined"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={loading}
                            placeholder="Explain the issue in detail..."
                            sx={{ mb: 3 }}
                        />

                        {/* Image file upload */}
                        <Box sx={{ mb: 4 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#475569', mb: 1 }}>
                                Upload Proof Image (Optional)
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <Button
                                    variant="outlined"
                                    component="label"
                                    disabled={loading}
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
                                        accept="image/*"
                                        hidden
                                        onChange={handleFileChange}
                                    />
                                </Button>
                                {photo && (
                                    <Typography variant="body2" color="#64748b" noWrap sx={{ maxWidth: '200px' }}>
                                        {photo.name}
                                    </Typography>
                                )}
                            </Box>
                            {photoPreview && (
                                <Box sx={{ mt: 2, position: 'relative', borderRadius: '5px', overflow: 'hidden', border: '1px solid #e2e8f0', width: '100%', height: '180px' }}>
                                    <img 
                                        src={photoPreview} 
                                        alt="Preview" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                    />
                                </Box>
                            )}
                        </Box>

                        {/* Submit and Cancel Buttons */}
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant="outlined"
                                fullWidth
                                disabled={loading}
                                onClick={onCancel}
                                sx={{
                                    borderColor: '#cbd5e1',
                                    color: '#475569',
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    borderRadius: '5px',
                                    '&:hover': {
                                        borderColor: '#94a3b8',
                                        backgroundColor: '#f1f5f9'
                                    }
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                variant="contained"
                                fullWidth
                                disabled={loading}
                                sx={{
                                    backgroundColor: '#14b8a6',
                                    color: '#ffffff',
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    borderRadius: '5px',
                                    '&:hover': {
                                        backgroundColor: '#0d9488'
                                    }
                                }}
                            >
                            {loading ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CircularProgress size={20} sx={{ color: '#fff' }} />
                                    <span>Validating image… (this may take up to 2 minutes)</span>
                                </Box>
                            ) : 'Submit Complaint'}
                            </Button>
                        </Box>
                    </form>
                </Box>
            </DialogContent>
        </Dialog>
    );
}
