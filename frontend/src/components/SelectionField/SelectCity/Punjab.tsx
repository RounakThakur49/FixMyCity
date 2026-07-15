import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const punjabCities: readonly string[] = [
    'Amritsar',
    'Bathinda',
    'Firozpur',
    'Hoshiarpur',
    'Jalandhar',
    'Ludhiana',
    'Moga',
    'Mohali',
    'Pathankot',
    'Patiala'
];
interface PunjabCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function PunjabCitySelect({ onCityChange, label }: PunjabCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Punjab-city-select"
            sx={{ width: "100%" }}
            options={punjabCities}
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