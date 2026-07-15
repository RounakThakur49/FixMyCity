import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const uttarakhandCities: readonly string[] = [
    'Dehradun',
    'Haldwani',
    'Haridwar',
    'Kashipur',
    'Rishikesh',
    'Roorkee',
    'Rudrapur'
];
interface UttarakhandCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function UttarakhandCitySelect({ onCityChange, label }: UttarakhandCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Uttarakhand-city-select"
            sx={{ width: "100%" }}
            options={uttarakhandCities}
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