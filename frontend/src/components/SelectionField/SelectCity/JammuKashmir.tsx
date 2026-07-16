import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and major towns in Jammu and Kashmir
const jammuKashmirCities: readonly string[] = [
    'Anantnag',
    'Baramulla',
    'Jammu',
    'Kathua',
    'Poonch',
    'Sopore',
    'Srinagar',
    'Udhampur'
];

interface JammuKashmirCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Jammu & Kashmir)" */
    label?: string;
}

export default function JammuKashmirCitySelect({ onCityChange, label }: JammuKashmirCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="jammu-kashmir-city-select"
            sx={{ width: "100%" }}
            options={jammuKashmirCities}
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
                    label={label || "Select City (Jammu & Kashmir)"}
                    variant="outlined"
                    placeholder="Search J&K cities..."
                />
            )}
        />
    );
}