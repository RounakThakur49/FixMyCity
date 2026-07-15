import { useState } from 'react';
import { postRegister } from '../../apis/functions';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import { Visibility, VisibilityOff } from '@mui/icons-material';

// Import Hero-style CSS
import './Registration.css';

// Import your Core State Picker and Types
import StateSelect, { type StateType } from '../SelectionField/StateSelect';

// Import individual city selection files from the correct SelectCity nested folder
import AndamanNicobar from '../SelectionField/SelectCity/AndamanNicobar';
import AndhraPradesh from '../SelectionField/SelectCity/AndhraPradesh';
import ArunachalPradesh from '../SelectionField/SelectCity/ArunachalPradesh';
import Assam from '../SelectionField/SelectCity/Assam';
import Bihar from '../SelectionField/SelectCity/Bihar';
import Chandigarh from '../SelectionField/SelectCity/Chandigarh';
import Chhattisgarh from '../SelectionField/SelectCity/Chhattisgarh';
import DadraNagarDamanDiu from '../SelectionField/SelectCity/DadraNagarDamanDiu';
import Delhi from '../SelectionField/SelectCity/Delhi';
import Goa from '../SelectionField/SelectCity/Goa';
import Gujarat from '../SelectionField/SelectCity/Gujarat';
import Haryana from '../SelectionField/SelectCity/Hariyana';
import HimachalPradesh from '../SelectionField/SelectCity/HimachalPradesh';
import JammuKashmirCitySelect from '../SelectionField/SelectCity/JammuKashmir';
import Jharkhand from '../SelectionField/SelectCity/Jhaarkhand';
import Karnataka from '../SelectionField/SelectCity/Karnataka';
import Kerala from '../SelectionField/SelectCity/Kerala';
import Ladakh from '../SelectionField/SelectCity/Ladakh';
import Lakshadweep from '../SelectionField/SelectCity/Lakshadweep';
import MadhyaPradesh from '../SelectionField/SelectCity/MadhyaPradesh';
import Maharashtra from '../SelectionField/SelectCity/Maharashtra';
import Manipur from '../SelectionField/SelectCity/Manipur';
import Meghalaya from '../SelectionField/SelectCity/Meghalaya';
import Mizoram from '../SelectionField/SelectCity/Mizoram';
import Nagaland from '../SelectionField/SelectCity/Nagaland';
import Odisha from '../SelectionField/SelectCity/Odisha';
import Puducherry from '../SelectionField/SelectCity/Puducherry';
import Punjab from '../SelectionField/SelectCity/Punjab';
import Rajasthan from '../SelectionField/SelectCity/Rajsthan';
import Sikkim from '../SelectionField/SelectCity/Sikkim';
import TamilNadu from '../SelectionField/SelectCity/Tamilnadu';
import Telangana from '../SelectionField/SelectCity/Telengana';
import Tripura from '../SelectionField/SelectCity/Tripura';
import UttarPradesh from '../SelectionField/SelectCity/UttarPradesh';
import Uttarakhand from '../SelectionField/SelectCity/Uttarakhand';
import WestBengal from '../SelectionField/SelectCity/WestBengal';
import { Divider } from '@mui/material';
import React from 'react';

interface RegistrationProps {
    setValue: (value: string) => void;
}

export default function Registration({ setValue }: RegistrationProps) {
    // Using uncontrolled inputs; form data will be accessed via FormData on submit

    const [chosenState, setChosenState] = useState<StateType | null>(null);
    const [chosenCity, setChosenCity] = useState<string | null>(null);
    // Public registration is CITIZEN ONLY. Admins are created by the super admin
    // from the usage dashboard; the single super admin is hard-coded. No role toggle.
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleCityChange = (city: string | null) => {
        setChosenCity(city);
    };

    const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        const formData = new FormData(e.currentTarget as HTMLFormElement);
        const password        = formData.get('password')        as string;
        const confirmPassword = formData.get('confirmPassword') as string;

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        const firstName = (formData.get('firstName') as string || '').trim();
        const lastName  = (formData.get('lastName')  as string || '').trim();

        // Our backend expects: { name, phone, aadhar, email, password }
        const data = {
            name:         `${firstName} ${lastName}`.trim(),
            firstName,
            lastName,
            email:        formData.get('email')      as string,
            phone:        formData.get('phone')      as string,
            aadhar:       formData.get('identifier') as string,
            aadharNumber: formData.get('identifier') as string,
            password,
        };

        try {
            setIsLoading(true);
            const response: any = await postRegister(data);
            // Registration auto-logs the citizen in — store the JWT
            if (response?.token) {
                sessionStorage.setItem('fmc_token', response.token);
                sessionStorage.setItem('user', JSON.stringify(response));
            }
            setSuccess(true);
            setTimeout(() => setValue('2'), 1500);   // Switch to Login tab
        } catch (err: any) {
            const message = err?.response?.data?.message ?? err?.message ?? 'Registration failed. Please try again.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };



    // Dynamically render the matching custom state file dropdown
    const renderCityDropdown = () => {
        if (!chosenState) {
            return (
                <Autocomplete
                    disabled
                    options={[]}
                    id="city-disabled-placeholder"
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Select City"
                            placeholder="Choose a state first"
                            variant="outlined"
                            size="small"
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 'var(--radius-inner)',
                                    fontSize: '0.9rem',
                                    background: 'rgba(255,255,255,0.8)',
                                    fontFamily: 'inherit',
                                },
                                '& .MuiInputLabel-root': {
                                    fontFamily: 'inherit',
                                    fontSize: '0.9rem',
                                },
                                width: '100%',
                            }}
                        />
                    )}
                />
            );
        }

        switch (chosenState.label) {
            case 'Andaman and Nicobar Islands': return <AndamanNicobar onCityChange={handleCityChange} label="Select City" />;
            case 'Andhra Pradesh': return <AndhraPradesh onCityChange={handleCityChange} label="Select City" />;
            case 'Arunachal Pradesh': return <ArunachalPradesh onCityChange={handleCityChange} label="Select City" />;
            case 'Assam': return <Assam onCityChange={handleCityChange} label="Select City" />;
            case 'Bihar': return <Bihar onCityChange={handleCityChange} label="Select City" />;
            case 'Chandigarh': return <Chandigarh onCityChange={handleCityChange} label="Select City" />;
            case 'Chhattisgarh': return <Chhattisgarh onCityChange={handleCityChange} label="Select City" />;
            case 'Dadra and Nagar Haveli and Daman and Diu': return <DadraNagarDamanDiu onCityChange={handleCityChange} label="Select City" />;
            case 'Delhi': return <Delhi onCityChange={handleCityChange} label="Select City" />;
            case 'Goa': return <Goa onCityChange={handleCityChange} label="Select City" />;
            case 'Gujarat': return <Gujarat onCityChange={handleCityChange} label="Select City" />;
            case 'Haryana': return <Haryana onCityChange={handleCityChange} label="Select City" />;
            case 'Himachal Pradesh': return <HimachalPradesh onCityChange={handleCityChange} label="Select City" />;
            case 'Jammu and Kashmir': return <JammuKashmirCitySelect onCityChange={handleCityChange} label="Select City" />;
            case 'Jharkhand': return <Jharkhand onCityChange={handleCityChange} label="Select City" />;
            case 'Karnataka': return <Karnataka onCityChange={handleCityChange} label="Select City" />;
            case 'Kerala': return <Kerala onCityChange={handleCityChange} label="Select City" />;
            case 'Ladakh': return <Ladakh onCityChange={handleCityChange} label="Select City" />;
            case 'Lakshadweep': return <Lakshadweep onCityChange={handleCityChange} label="Select City" />;
            case 'Madhya Pradesh': return <MadhyaPradesh onCityChange={handleCityChange} label="Select City" />;
            case 'Maharashtra': return <Maharashtra onCityChange={handleCityChange} label="Select City" />;
            case 'Manipur': return <Manipur onCityChange={handleCityChange} label="Select City" />;
            case 'Meghalaya': return <Meghalaya onCityChange={handleCityChange} label="Select City" />;
            case 'Mizoram': return <Mizoram onCityChange={handleCityChange} label="Select City" />;
            case 'Nagaland': return <Nagaland onCityChange={handleCityChange} label="Select City" />;
            case 'Odisha': return <Odisha onCityChange={handleCityChange} label="Select City" />;
            case 'Puducherry': return <Puducherry onCityChange={handleCityChange} label="Select City" />;
            case 'Punjab': return <Punjab onCityChange={handleCityChange} label="Select City" />;
            case 'Rajasthan': return <Rajasthan onCityChange={handleCityChange} label="Select City" />;
            case 'Sikkim': return <Sikkim onCityChange={handleCityChange} label="Select City" />;
            case 'Tamil Nadu': return <TamilNadu onCityChange={handleCityChange} label="Select City" />;
            case 'Telangana': return <Telangana onCityChange={handleCityChange} label="Select City" />;
            case 'Tripura': return <Tripura onCityChange={handleCityChange} label="Select City" />;
            case 'Uttar Pradesh': return <UttarPradesh onCityChange={handleCityChange} label="Select City" />;
            case 'Uttarakhand': return <Uttarakhand onCityChange={handleCityChange} label="Select City" />;
            case 'West Bengal': return <WestBengal onCityChange={handleCityChange} label="Select City" />;
            default: return null;
        }
    };

    return (
        <div className="registration-shell">
            <div className="reg-hero-panel">

                {/* Header */}
                <div className="form-title-group">
                    <span className="eyebrow-modern">Create your account</span>
                    <h2>Register Here</h2>
                    <p>Fill in your details below to get started.</p>
                </div>

                {/* Form */}
                <form className="auth-form-modern" noValidate autoComplete="off" onSubmit={handleRegister}>

                    {/* Row 1: First Name & Last Name */}
                    <div className="form-two-col">
                        <div className="input-group">
                            <label htmlFor="first-name">First Name</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                <input
                                    required
                                    id="first-name"
                                    name="firstName"
                                    type="text"
                                    placeholder="John"
                                />
                            </div>
                        </div>

                        <div className="input-group">
                            <label htmlFor="last-name">Last Name</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                <input
                                    required
                                    id="last-name"
                                    name="lastName"
                                    type="text"
                                    placeholder="Doe"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Email & Phone */}
                    <div className="form-two-col">
                        <div className="input-group">
                            <label htmlFor="email">Email</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                                <input
                                    required
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="john@example.com"
                                />
                            </div>
                        </div>

                        <div className="input-group">
                            <label htmlFor="phone">Phone Number</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                                <input
                                    required
                                    id="phone"
                                    name="phone"
                                    type="tel"
                                    placeholder="Enter 10-digit number"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Row 3: Address (full width) */}
                    <div className="input-group">
                        <label htmlFor="address">Address</label>
                        <textarea
                            id="address"
                            name="address"
                            placeholder="Enter your full address"
                            rows={3}
                        />
                    </div>

                    {/* Row 4: State & City */}
                    <div className="form-two-col">
                        <div className="input-group">
                            <label>State</label>
                            <StateSelect onStateChange={(state) => {
                                setChosenState(state);
                                setChosenCity(null);
                            }} />
                        </div>

                        <div className="input-group">
                            <label>City</label>
                            {renderCityDropdown()}
                        </div>
                    </div>

                    {/* Hidden fields for form values (citizen-only registration) */}
                    <input type="hidden" name="state" value={chosenState ? chosenState.label : ''} />
                    <input type="hidden" name="city" value={chosenCity ? chosenCity : ''} />
                    <input type="hidden" name="role" value="citizen" />

                    {/* Aadhar number (Citizen) */}
                    <div className="input-group">
                        <label htmlFor="identifier">
                            Aadhar Number
                        </label>
                        <TextField
                            required
                            id="identifier"
                            name="identifier"
                            type="number"
                            variant="outlined"
                            size="small"
                            placeholder="Enter your 12-digit Aadhar number"
                            slotProps={{
                                htmlInput: {
                                    maxLength: 12,
                                    minLength: 12,
                                    inputMode: 'numeric',
                                },
                            }}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: 'var(--radius-inner)',
                                    fontSize: '0.9rem',
                                    background: 'rgba(255,255,255,0.8)',
                                    fontFamily: 'inherit',
                                },
                                '& .MuiInputLabel-root': {
                                    fontFamily: 'inherit',
                                    fontSize: '0.9rem',
                                },
                                width: '100%',
                            }}
                        />
                    </div>

                    {/* Row 5: Password */}
                    <div className="form-two-col">
                        <div className="input-group">
                            <label htmlFor="password">Password</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                                <input
                                    required
                                    id="password"
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Create a strong password"
                                    autoComplete="new-password"
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

                        <div className="input-group">
                            <label htmlFor="password">Confirm Password</label>
                            <div className="input-wrapper">
                                <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                                <input
                                    required
                                    id="cpassword"
                                    name="confirmPassword"
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    placeholder="Confirm password"
                                    autoComplete="new-password"
                                />
                                <IconButton
                                    onClick={() => setShowConfirmPassword(v => !v)}
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
                                    {showConfirmPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                </IconButton>
                            </div>
                        </div>
                    </div>

                    {/* Error / Success feedback */}
                    {error && (
                        <p style={{ color: 'var(--color-error, #e53e3e)', fontSize: '0.85rem', margin: '0' }}>
                            {error}
                        </p>
                    )}
                    {success && (
                        <p style={{ color: 'var(--color-success, #38a169)', fontSize: '0.85rem', margin: '0' }}>
                            Registration successful! You can now log in.
                        </p>
                    )}

                    {/* Submit */}
                    <button type="submit" className="primary-btn" disabled={isLoading}>
                        {isLoading ? 'Registering…' : 'Create Account'}
                    </button>
                </form>

                <Divider sx={{ my: 3, borderColor: 'rgba(12, 24, 22, 0.15)' }} />
                {/* Footer */}
                <div className="reg-footer-note">
                    <span>Already have an account?</span>
                    <button type="button" className="ghost-btn" onClick={() => { setValue("2") }}>Login</button>
                </div>

            </div>
        </div>
    );
}