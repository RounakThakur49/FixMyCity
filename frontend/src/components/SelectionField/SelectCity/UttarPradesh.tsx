import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const uttarPradeshCities: readonly string[] = [
    'Agra',
    'Aligarh',
    'Bareilly',
    'Ghaziabad',
    'Gorakhpur',
    'Greater Noida',
    'Jhansi',
    'Kanpur',
    'Lucknow',
    'Meerut',
    'Moradabad',
    'Noida',
    'Prayagraj',
    'Saharanpur',
    'Varanasi'
];
interface UttarPradeshCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function UttarPradeshCitySelect({ onCityChange, label }: UttarPradeshCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="UttarPradesh-city-select"
            sx={{ width: "100%" }}
            options={uttarPradeshCities}
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