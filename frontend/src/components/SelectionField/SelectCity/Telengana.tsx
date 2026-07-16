import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const telanganaCities: readonly string[] = [
    'Hyderabad',
    'Karimnagar',
    'Khammam',
    'Mahbubnagar',
    'Nalgonda',
    'Nizamabad',
    'Ramagundam',
    'Warangal'
];
interface TelanganaCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function TelanganaCitySelect({ onCityChange, label }: TelanganaCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Telangana-city-select"
            sx={{ width: "100%" }}
            options={telanganaCities}
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