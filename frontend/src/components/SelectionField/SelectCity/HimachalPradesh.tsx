import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const himachalPradeshCities: readonly string[] = [
    'Bilaspur',
    'Chamba',
    'Dharamshala',
    'Hamirpur',
    'Kullu',
    'Manali',
    'Mandi',
    'Nahan',
    'Shimla',
    'Solan',
    'Una'
];

interface HimachalPradeshCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function HimachalPradeshCitySelect({ onCityChange, label }: HimachalPradeshCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="HimachalPradesh-city-select"
            sx={{ width: "100%" }}
            options={himachalPradeshCities}
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