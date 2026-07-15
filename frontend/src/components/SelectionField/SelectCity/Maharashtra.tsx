import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const maharashtraCities: readonly string[] = [
    'Ahmednagar',
    'Akola',
    'Amravati',
    'Chandrapur',
    'Chhatrapati Sambhajinagar',
    'Jalgaon',
    'Kalyan-Dombivli',
    'Kolhapur',
    'Latur',
    'Mumbai',
    'Nagpur',
    'Nanded',
    'Nashik',
    'Navi Mumbai',
    'Parbhani',
    'Pune',
    'Sangli-Miraj',
    'Solapur',
    'Thane',
    'Vasai-Virar'
];
interface MaharashtraCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function MaharashtraCitySelect({ onCityChange, label }: MaharashtraCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Maharashtra-city-select"
            sx={{ width: "100%" }}
            options={maharashtraCities}
            autoHighlight
            value={value}
            onChange={(event, newValue) => {
                setValue(newValue);
                if (onCityChange) {
                    onCityChange(newValue);
                }
            }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label || "Select City (Assam)"}
                    variant="outlined"
                    placeholder="Search Assam cities..."
                />
            )}
        />
    );
}