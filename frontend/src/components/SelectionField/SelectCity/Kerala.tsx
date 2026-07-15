import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const keralaCities: readonly string[] = [
    'Alappuzha',
    'Kanhangad',
    'Kannur',
    'Kochi',
    'Kollam',
    'Kottayam',
    'Kozhikode',
    'Malappuram',
    'Palakkad',
    'Thalassery',
    'Thiruvananthapuram',
    'Thrissur'
];

interface KeralaCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function KeralaCitySelect({ onCityChange, label }: KeralaCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Kerala-city-select"
            sx={{ width: "100%" }}
            options={keralaCities}
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