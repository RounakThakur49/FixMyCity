import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const rajasthanCities: readonly string[] = [
    'Ajmer',
    'Alwar',
    'Bharatpur',
    'Bhilwara',
    'Bikaner',
    'Jaipur',
    'Jodhpur',
    'Kota',
    'Sikar',
    'Sri Ganganagar',
    'Udaipur'
];
interface RajsthanCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function RajsthanCitySelect({ onCityChange, label }: RajsthanCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Rajsthan-city-select"
            sx={{ width: "100%" }}
            options={rajasthanCities}
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