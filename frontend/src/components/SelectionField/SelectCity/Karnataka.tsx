import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const karnatakaCities: readonly string[] = [
    'Ballari',
    'Belagavi',
    'Bengaluru',
    'Bidar',
    'Chikkamagaluru',
    'Davangere',
    'Hubballi-Dharwad',
    'Kalaburagi',
    'Hassan',
    'Mangaluru',
    'Mysuru',
    'Raichur',
    'Shivamogga',
    'Tumakuru',
    'Udupi',
    'Vijayapura'
];

interface KarnatakaCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function KarnatakaCitySelect({ onCityChange, label }: KarnatakaCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Karnataka-city-select"
            sx={{ width: "100%" }}
            options={karnatakaCities}
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