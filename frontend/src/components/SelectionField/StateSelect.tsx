import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

export interface StateType {
    code: string;
    label: string;
    type: 'State' | 'Union Territory';
}

interface StateSelectProps {
    onStateChange: (state: StateType | null) => void;
}

export default function StateSelect({ onStateChange }: StateSelectProps) {
    return (
        <Autocomplete
            id="india-state-select"
            sx={{ width: '100%' }}
            options={indianStates}
            groupBy={(option) => option.type}
            autoHighlight
            getOptionLabel={(option) => option.label}
            onChange={(event, newValue) => {
                onStateChange(newValue);
            }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label="Select State or UT"
                    variant="outlined"
                    placeholder="Search state or UT..."
                    required
                />
            )}
            renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return (
                    <li
                        key={key}
                        {...optionProps}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            fontSize: '0.9rem',
                        }}
                    >
                        <span style={{ color: '#0f172a', fontWeight: 500 }}>{option.label}</span>
                        <span
                            style={{
                                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: '#0f766e',
                                background: 'rgba(15, 118, 110, 0.08)',
                                borderRadius: '6px',
                                padding: '2px 7px',
                                letterSpacing: '0.02em',
                                flexShrink: 0,
                            }}
                        >
                            {option.code.replace('IN-', '')}
                        </span>
                    </li>
                );
            }}
        />
    );
}

const indianStates: readonly StateType[] = [
    { code: 'IN-AN', label: 'Andaman and Nicobar Islands', type: 'Union Territory' },
    { code: 'IN-AP', label: 'Andhra Pradesh', type: 'State' },
    { code: 'IN-AR', label: 'Arunachal Pradesh', type: 'State' },
    { code: 'IN-AS', label: 'Assam', type: 'State' },
    { code: 'IN-BR', label: 'Bihar', type: 'State' },
    { code: 'IN-CH', label: 'Chandigarh', type: 'Union Territory' },
    { code: 'IN-CT', label: 'Chhattisgarh', type: 'State' },
    { code: 'IN-DH', label: 'Dadra and Nagar Haveli and Daman and Diu', type: 'Union Territory' },
    { code: 'IN-DL', label: 'Delhi', type: 'Union Territory' },
    { code: 'IN-GA', label: 'Goa', type: 'State' },
    { code: 'IN-GJ', label: 'Gujarat', type: 'State' },
    { code: 'IN-HR', label: 'Haryana', type: 'State' }, // Matches your switch case string
    { code: 'IN-HP', label: 'Himachal Pradesh', type: 'State' },
    { code: 'IN-JK', label: 'Jammu and Kashmir', type: 'Union Territory' },
    { code: 'IN-JH', label: 'Jharkhand', type: 'State' }, // Matches your switch case string
    { code: 'IN-KA', label: 'Karnataka', type: 'State' },
    { code: 'IN-KL', label: 'Kerala', type: 'State' },
    { code: 'IN-LA', label: 'Ladakh', type: 'Union Territory' },
    { code: 'IN-LD', label: 'Lakshadweep', type: 'Union Territory' },
    { code: 'IN-MP', label: 'Madhya Pradesh', type: 'State' },
    { code: 'IN-MH', label: 'Maharashtra', type: 'State' },
    { code: 'IN-MN', label: 'Manipur', type: 'State' },
    { code: 'IN-ML', label: 'Meghalaya', type: 'State' },
    { code: 'IN-MZ', label: 'Mizoram', type: 'State' },
    { code: 'IN-NL', label: 'Nagaland', type: 'State' },
    { code: 'IN-OR', label: 'Odisha', type: 'State' },
    { code: 'IN-PY', label: 'Puducherry', type: 'Union Territory' },
    { code: 'IN-PB', label: 'Punjab', type: 'State' },
    { code: 'IN-RJ', label: 'Rajasthan', type: 'State' }, // Matches your switch case string
    { code: 'IN-SK', label: 'Sikkim', type: 'State' },
    { code: 'IN-TN', label: 'Tamil Nadu', type: 'State' }, // Matches your switch case string
    { code: 'IN-TG', label: 'Telangana', type: 'State' }, // Matches your switch case string
    { code: 'IN-TR', label: 'Tripura', type: 'State' },
    { code: 'IN-UP', label: 'Uttar Pradesh', type: 'State' },
    { code: 'IN-UT', label: 'Uttarakhand', type: 'State' },
    { code: 'IN-WB', label: 'West Bengal', type: 'State' },
];