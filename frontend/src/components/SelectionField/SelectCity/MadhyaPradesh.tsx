import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const madhyaPradeshCities: readonly string[] = [
    'Bhopal',
    'Burhanpur',
    'Chhindwara',
    'Dewas',
    'Gwalior',
    'Indore',
    'Jabalpur',
    'Khandwa',
    'Murwara',
    'Ratlam',
    'Rewa',
    'Sagar',
    'Satna',
    'Singrauli',
    'Ujjain'
];
interface MadhyapradeshCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function MadhyapradeshCitySelect({ onCityChange, label }: MadhyapradeshCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Madhyapradesh-city-select"
            sx={{ width: "100%" }}
            options={madhyaPradeshCities}
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